import { describe, expect, it, vi } from 'vitest';

import {
  authenticateLdapUser,
  formatActiveDirectoryGuid,
  LdapAuthenticationError,
  type LdapDirectoryClient,
} from '@/lib/server/identity/ldap/directory';
import type { LdapConfig } from '@/lib/server/identity/ldap/config';

const CONFIG: LdapConfig = {
  url: 'ldap://localhost:389',
  startTLS: false,
  allowInsecure: false,
  bindDn: null,
  bindPassword: null,
  searchBase: 'ou=people,dc=example,dc=com',
  userFilter: '(&(objectClass=person)(uid={username}))',
  userIdAttribute: 'entryUUID',
  displayNameAttribute: 'displayName',
  timeoutMs: 5000,
  sessionSecret: 's'.repeat(48),
  sessionTtlSeconds: 3600,
};

function fakeClient(overrides: Partial<LdapDirectoryClient> = {}) {
  const client: LdapDirectoryClient = {
    bind: vi.fn(async () => {}),
    search: vi.fn(async () => ({
      searchEntries: [
        {
          dn: 'uid=alice,ou=people,dc=example,dc=com',
          entryUUID: 'uuid-alice',
          displayName: 'Alice',
        },
      ],
    })),
    unbind: vi.fn(async () => {}),
    ...overrides,
  };
  return client;
}

function deps(client: LdapDirectoryClient, config: LdapConfig = CONFIG) {
  return { config, createClient: () => client };
}

describe('authenticateLdapUser', () => {
  it('binds as the user and returns a stable owner id', async () => {
    const client = fakeClient();
    const identity = await authenticateLdapUser(
      { username: 'alice', password: 'correct' },
      deps(client),
    );

    expect(identity).toEqual({
      ownerId: 'ldap:uuid-alice',
      userId: 'uuid-alice',
      displayName: 'Alice',
      dn: 'uid=alice,ou=people,dc=example,dc=com',
    });
    expect(client.search).toHaveBeenCalledWith(
      CONFIG.searchBase,
      expect.objectContaining({
        scope: 'sub',
        filter: '(&(objectClass=person)(uid=alice))',
      }),
    );
    expect(client.bind).toHaveBeenCalledWith('uid=alice,ou=people,dc=example,dc=com', 'correct');
    expect(client.unbind).toHaveBeenCalled();
  });

  it('binds the service account before searching when configured', async () => {
    const client = fakeClient();
    await authenticateLdapUser(
      { username: 'alice', password: 'correct' },
      deps(client, {
        ...CONFIG,
        bindDn: 'cn=openmaic,dc=example,dc=com',
        bindPassword: 'service-secret',
      }),
    );
    expect(client.bind).toHaveBeenNthCalledWith(
      1,
      'cn=openmaic,dc=example,dc=com',
      'service-secret',
    );
    expect(client.bind).toHaveBeenNthCalledWith(
      2,
      'uid=alice,ou=people,dc=example,dc=com',
      'correct',
    );
  });

  it('escapes the username inside the filter', async () => {
    const client = fakeClient();
    await authenticateLdapUser({ username: 'a*lice', password: 'correct' }, deps(client));
    expect(client.search).toHaveBeenCalledWith(
      CONFIG.searchBase,
      expect.objectContaining({ filter: '(&(objectClass=person)(uid=a\\2alice))' }),
    );
  });

  it('strips a domain prefix from a DOMAIN\\user login', async () => {
    const client = fakeClient();
    await authenticateLdapUser({ username: 'EXAMPLE\\alice', password: 'correct' }, deps(client));
    expect(client.search).toHaveBeenCalledWith(
      CONFIG.searchBase,
      expect.objectContaining({ filter: '(&(objectClass=person)(uid=alice))' }),
    );
    expect(client.bind).toHaveBeenCalledWith('uid=alice,ou=people,dc=example,dc=com', 'correct');
  });

  it('replaces every placeholder in the filter', async () => {
    const client = fakeClient();
    await authenticateLdapUser(
      { username: 'alice', password: 'correct' },
      deps(client, {
        ...CONFIG,
        userFilter:
          '(&(objectClass=person)(|(sAMAccountName={username})(userPrincipalName={username})))',
      }),
    );
    expect(client.search).toHaveBeenCalledWith(
      CONFIG.searchBase,
      expect.objectContaining({
        filter: '(&(objectClass=person)(|(sAMAccountName=alice)(userPrincipalName=alice)))',
      }),
    );
  });

  it('refuses an empty password without contacting the directory', async () => {
    const createClient = vi.fn();
    await expect(
      authenticateLdapUser(
        { username: 'alice', password: '' },
        {
          config: CONFIG,
          createClient: createClient as never,
        },
      ),
    ).rejects.toMatchObject({ kind: 'invalid-credentials' });
    expect(createClient).not.toHaveBeenCalled();
  });

  it('refuses an unknown user as invalid credentials', async () => {
    const client = fakeClient({
      search: vi.fn(async () => ({ searchEntries: [] })),
    });
    await expect(
      authenticateLdapUser({ username: 'nobody', password: 'x' }, deps(client)),
    ).rejects.toMatchObject({ kind: 'invalid-credentials' });
    expect(client.unbind).toHaveBeenCalled();
  });

  it('refuses an ambiguous search result', async () => {
    const client = fakeClient({
      search: vi.fn(async () => ({
        searchEntries: [
          { dn: 'uid=a,dc=x', entryUUID: '1' },
          { dn: 'uid=b,dc=x', entryUUID: '2' },
        ],
      })),
    });
    await expect(
      authenticateLdapUser({ username: 'alice', password: 'x' }, deps(client)),
    ).rejects.toMatchObject({ kind: 'ambiguous-user' });
  });

  it('maps LDAP invalid-credentials (49) to a 401 kind', async () => {
    const client = fakeClient({
      bind: vi.fn(async () => {
        throw Object.assign(new Error('invalid credentials'), { code: 49 });
      }),
    });
    await expect(
      authenticateLdapUser({ username: 'alice', password: 'wrong' }, deps(client)),
    ).rejects.toMatchObject({ kind: 'invalid-credentials' });
  });

  it('maps a directory failure to unavailable', async () => {
    const client = fakeClient({
      search: vi.fn(async () => {
        throw Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
      }),
    });
    const error = await authenticateLdapUser(
      { username: 'alice', password: 'x' },
      deps(client),
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LdapAuthenticationError);
    expect((error as LdapAuthenticationError).kind).toBe('directory-unavailable');
  });

  it('converts a binary objectGUID to its canonical GUID', () => {
    const guid = Buffer.from([
      0x78, 0x56, 0x34, 0x12, 0xbc, 0x9a, 0xf0, 0xde, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77,
      0x88,
    ]);
    expect(formatActiveDirectoryGuid(guid)).toBe('12345678-9abc-def0-1122-334455667788');
  });

  it('falls back to the DN when the id attribute is absent', async () => {
    const client = fakeClient({
      search: vi.fn(async () => ({
        searchEntries: [{ dn: 'UID=Bob,OU=People,DC=Example,DC=COM', displayName: 'Bob' }],
      })),
    });
    const identity = await authenticateLdapUser({ username: 'bob', password: 'x' }, deps(client));
    expect(identity.ownerId).toBe('ldap:uid=bob,ou=people,dc=example,dc=com');
  });
});
