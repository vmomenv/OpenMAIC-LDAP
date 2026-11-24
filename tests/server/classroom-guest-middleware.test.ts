import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/identity/ldap/config', () => ({
  ldapEnabled: () => true,
  readLdapConfig: () => ({ sessionSecret: 'test-secret' }),
}));

import { createLdapSession } from '@/lib/server/identity/ldap/session';
import { middleware } from '../../middleware';

const OWNER = 'classroom-guest:00000000-0000-4000-8000-000000000001';
const GUEST = `openmaic_guest=1; openmaic_guest_owner=${OWNER}`;

function page(path = '/classroom/stage-1') {
  return new NextRequest(`http://localhost${path}`, {
    headers: { accept: 'text/html', 'sec-fetch-dest': 'document' },
  });
}

function api(path: string, cookie: string, method = 'POST') {
  return new NextRequest(`http://localhost${path}`, { method, headers: { cookie } });
}

function ldapSessionCookie() {
  return `openmaic_ldap=${createLdapSession({ ownerId: 'ldap:u1' }, { secret: 'test-secret' }).token}`;
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe('middleware guest passage', () => {
  it('lets a classroom page through and mints the guest cookies', async () => {
    const response = await middleware(page());

    expect(response.status).toBe(200);
    const cookies = response.headers.getSetCookie().join('\n');
    expect(cookies).toContain('openmaic_guest=1');
    expect(cookies).toContain('openmaic_guest_owner=classroom-guest:');
    expect(cookies).toContain('openmaic_guest_stage=stage-1');
  });

  it('reuses an existing guest owner instead of minting a new one', async () => {
    const request = page();
    request.headers.set('cookie', GUEST);
    const response = await middleware(request);

    const cookies = response.headers.getSetCookie().join('\n');
    expect(cookies).not.toContain('openmaic_guest_owner=');
    expect(cookies).toContain('openmaic_guest_stage=stage-1');
  });

  it('lets allowlisted classroom APIs through for a guest', async () => {
    const response = await middleware(api('/api/quiz-grade', `${GUEST}; openmaic_guest_stage=stage-1`));
    expect(response.status).not.toBe(401);
  });

  it('keeps every other API behind the LDAP gate', async () => {
    const response = await middleware(api('/api/generate-classroom', GUEST));
    expect(response.status).toBe(401);
  });

  it('keeps a private page request behind the gate when no guest cookies are present', async () => {
    const response = await middleware(
      new NextRequest('http://localhost/api/quiz-grade', { method: 'POST' }),
    );
    expect(response.status).toBe(401);
  });

  it('does not mint guest cookies for a signed-in user', async () => {
    const request = page();
    request.headers.set('cookie', ldapSessionCookie());
    const response = await middleware(request);

    expect(response.headers.getSetCookie().join('\n')).not.toContain('openmaic_guest');
  });
});
