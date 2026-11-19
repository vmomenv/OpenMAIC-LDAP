import { describe, expect, it } from 'vitest';

import type { LdapConfig } from '@/lib/server/identity/ldap/config';
import { createLdapAuthMethod } from '@/lib/server/identity/ldap/auth-method';
import { createLdapSession, LDAP_SESSION_COOKIE } from '@/lib/server/identity/ldap/session';

const SECRET = 's'.repeat(48);
const NOW = 1_800_000_000_000;
const TTL = 3600;

const CONFIG: LdapConfig = {
  url: 'ldap://localhost:389',
  startTLS: false,
  allowInsecure: false,
  bindDn: null,
  bindPassword: null,
  searchBase: 'ou=people,dc=example,dc=com',
  userFilter: '(uid={username})',
  userIdAttribute: 'entryUUID',
  displayNameAttribute: 'displayName',
  timeoutMs: 5000,
  sessionSecret: SECRET,
  sessionTtlSeconds: TTL,
};

function request(cookie?: string) {
  return { headers: new Headers(cookie ? { cookie } : {}) };
}

function validToken(now = NOW) {
  return createLdapSession(
    { ownerId: 'ldap:alice', name: 'Alice' },
    { secret: SECRET, ttlSeconds: TTL, now },
  ).token;
}

describe('the LDAP owner auth method', () => {
  it('is not applicable without its cookie', async () => {
    const method = createLdapAuthMethod({ config: CONFIG, now: () => NOW });
    await expect(method.authenticate(request())).resolves.toEqual({ status: 'not-applicable' });
  });

  it('refuses a malformed or expired cookie', async () => {
    const method = createLdapAuthMethod({ config: CONFIG, now: () => NOW });
    await expect(
      method.authenticate(request(`${LDAP_SESSION_COOKIE}=garbage`)),
    ).resolves.toMatchObject({ status: 'invalid' });

    const expired = validToken(NOW - TTL * 1000 - 1);
    await expect(
      method.authenticate(request(`${LDAP_SESSION_COOKIE}=${expired}`)),
    ).resolves.toMatchObject({ status: 'invalid' });
  });

  it('authenticates the session owner as a publishing user', async () => {
    const method = createLdapAuthMethod({ config: CONFIG, now: () => NOW });
    const result = await method.authenticate(request(`${LDAP_SESSION_COOKIE}=${validToken()}`));
    expect(result).toMatchObject({
      status: 'authenticated',
      principal: {
        ownerId: 'ldap:alice',
        kind: 'user',
        assurance: 'verified',
      },
    });
    if (result.status !== 'authenticated') throw new Error('unreachable');
    expect([...result.principal.roles]).toContain('course:publish');
    expect(result.setCookies).toBeUndefined();
  });

  it('renews a session that is near expiry', async () => {
    const token = validToken();
    const method = createLdapAuthMethod({
      config: CONFIG,
      now: () => NOW + TTL * 1000 - 1000,
    });
    const result = await method.authenticate(request(`${LDAP_SESSION_COOKIE}=${token}`));
    if (result.status !== 'authenticated') throw new Error('unreachable');
    expect(result.setCookies).toHaveLength(1);
    expect(result.setCookies?.[0]).toContain(`${LDAP_SESSION_COOKIE}=`);
  });

  it('describes stored LDAP owners and refuses other ids', () => {
    const method = createLdapAuthMethod({ config: CONFIG, now: () => NOW });
    expect(method.describeStoredOwner?.('ldap:alice')).toEqual({
      kind: 'user',
      roles: new Set(['course:publish']),
    });
    expect(method.describeStoredOwner?.('anon:123')).toBeUndefined();
  });
});
