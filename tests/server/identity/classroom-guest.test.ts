import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ldapEnabled: true,
  access: null as Record<string, unknown> | null,
}));

vi.mock('@/lib/server/identity/ldap/config', () => ({
  ldapEnabled: () => mocks.ldapEnabled,
  readLdapConfig: () => ({ sessionSecret: 'test-secret' }),
}));
vi.mock('@/lib/server/stage-access', () => ({
  resolveStageAccess: async () => mocks.access,
}));

import { createLdapSession } from '@/lib/server/identity/ldap/session';
import { classroomGuestAuthMethod } from '@/lib/server/identity/classroom-guest/auth-method';
import {
  assertGuestCapability,
  isStageReadableByGuest,
  readGuestStageContext,
} from '@/lib/server/identity/classroom-guest/access';

const OWNER = 'classroom-guest:00000000-0000-4000-8000-000000000001';
const SECRET = 'test-secret';
const GUEST_COOKIES = `openmaic_guest=1; openmaic_guest_owner=${OWNER}; openmaic_guest_stage=stage-1`;

function request(url: string, cookie = GUEST_COOKIES, extra: Record<string, string> = {}) {
  return {
    url,
    method: 'POST',
    headers: new Headers({ cookie, ...extra }),
  };
}

function ldapCookie() {
  return `openmaic_ldap=${createLdapSession(
    { ownerId: 'ldap:user-1' },
    { secret: SECRET },
  ).token}`;
}

beforeEach(() => {
  mocks.ldapEnabled = true;
  mocks.access = {
    stageId: 'stage-1',
    ownerId: 'ldap:teacher',
    name: 'Course',
    isPublic: true,
    publishedAt: 1,
    generationComplete: true,
    guestQuiz: false,
    guestTts: false,
    guestChat: true,
    guestPbl: false,
    guestLocalRecords: true,
    source: 'document',
    deletedAt: null,
  };
});

describe('classroomGuestAuthMethod', () => {
  const method = classroomGuestAuthMethod({ ldapSessionSecret: SECRET });

  it('authenticates a guest on the classroom API surface', async () => {
    await expect(method.authenticate(request('http://localhost/api/quiz-grade'))).resolves.toEqual({
      status: 'authenticated',
      principal: expect.objectContaining({
        ownerId: OWNER,
        kind: 'anonymous',
        channel: 'classroom-guest',
      }),
    });
  });

  it('does not reach paths outside the guest surface', async () => {
    await expect(
      method.authenticate(request('http://localhost/api/generate-classroom')),
    ).resolves.toEqual({ status: 'not-applicable' });
  });

  it('declines when the request carries a live LDAP session', async () => {
    await expect(
      method.authenticate(request('http://localhost/api/quiz-grade', ldapCookie())),
    ).resolves.toEqual({ status: 'not-applicable' });
  });

  it('declines without a guest cookie or owner', async () => {
    await expect(
      method.authenticate(request('http://localhost/api/quiz-grade', 'openmaic_guest=1')),
    ).resolves.toEqual({ status: 'not-applicable' });
    await expect(
      method.authenticate(request('http://localhost/api/quiz-grade', 'openmaic_guest_owner=x')),
    ).resolves.toEqual({ status: 'not-applicable' });
  });
});

describe('readGuestStageContext', () => {
  it('prefers the explicit header', () => {
    expect(
      readGuestStageContext(request('http://localhost/api/quiz-grade', GUEST_COOKIES, {
        'x-openmaic-classroom': 'stage-header',
        referer: 'http://localhost/classroom/stage-referer',
      })),
    ).toBe('stage-header');
  });

  it('falls back to the Referer path then the cookie', () => {
    expect(
      readGuestStageContext(
        request('http://localhost/api/quiz-grade', GUEST_COOKIES, {
          referer: 'http://localhost/classroom/stage-referer?scene=x',
        }),
      ),
    ).toBe('stage-referer');
    expect(readGuestStageContext(request('http://localhost/api/quiz-grade'))).toBe('stage-1');
  });
});

describe('assertGuestCapability', () => {
  it('allows a capability the teacher enabled', async () => {
    await expect(assertGuestCapability(request('http://localhost/api/chat/pi'), 'chat')).resolves.toBeUndefined();
  });

  it('refuses a capability the teacher left off', async () => {
    const response = await assertGuestCapability(request('http://localhost/api/quiz-grade'), 'quiz');
    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toMatchObject({
      error: { code: 'GUEST_CAPABILITY_DISABLED' },
    });
  });

  it('refuses after the course is unpublished', async () => {
    mocks.access!.isPublic = false;
    const response = await assertGuestCapability(request('http://localhost/api/chat/pi'), 'chat');
    expect(response?.status).toBe(403);
  });

  it('refuses when the request names no classroom', async () => {
    const response = await assertGuestCapability(
      request('http://localhost/api/chat/pi', 'openmaic_guest=1; openmaic_guest_owner=' + OWNER),
      'chat',
    );
    expect(response?.status).toBe(403);
  });

  it('lets a signed-in user through and demands a credential otherwise', async () => {
    await expect(
      assertGuestCapability(request('http://localhost/api/quiz-grade', ldapCookie()), 'quiz'),
    ).resolves.toBeUndefined();
    const response = await assertGuestCapability(
      request('http://localhost/api/quiz-grade', ''),
      'quiz',
    );
    expect(response?.status).toBe(401);
  });

  it('is a no-op outside LDAP mode', async () => {
    mocks.ldapEnabled = false;
    await expect(
      assertGuestCapability(request('http://localhost/api/quiz-grade', ''), 'quiz'),
    ).resolves.toBeUndefined();
  });
});

describe('isStageReadableByGuest', () => {
  it('allows only published, live courses', async () => {
    await expect(isStageReadableByGuest('stage-1')).resolves.toBe(true);
    mocks.access = null;
    await expect(isStageReadableByGuest('stage-2')).resolves.toBe(false);
  });
});
