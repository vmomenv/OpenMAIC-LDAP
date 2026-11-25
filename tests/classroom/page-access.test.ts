import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ldapEnabled: true,
  liveSession: false,
  access: null as Record<string, unknown> | null,
}));

vi.mock('@/lib/server/identity/ldap/config', () => ({
  ldapEnabled: () => mocks.ldapEnabled,
}));
vi.mock('@/lib/server/identity/classroom-guest/session', () => ({
  hasLiveLdapSession: () => mocks.liveSession,
}));
vi.mock('@/lib/server/stage-access', () => ({
  resolveStageAccess: async () => mocks.access,
}));

import { resolveClassroomPageAccess } from '@/lib/classroom/page-access';

const headers = new Headers();

beforeEach(() => {
  mocks.ldapEnabled = true;
  mocks.liveSession = false;
  mocks.access = {
    stageId: 'stage-1',
    ownerId: 'ldap:teacher',
    isPublic: true,
    guestLocalRecords: true,
    deletedAt: null,
  };
});

describe('resolveClassroomPageAccess', () => {
  it('renders without a gate outside LDAP mode', async () => {
    mocks.ldapEnabled = false;
    await expect(resolveClassroomPageAccess('stage-1', headers)).resolves.toEqual({
      kind: 'render',
      guest: false,
      guestLocalRecords: false,
    });
  });

  it('renders as an account when a live LDAP session is present', async () => {
    mocks.liveSession = true;
    await expect(resolveClassroomPageAccess('stage-1', headers)).resolves.toEqual({
      kind: 'render',
      guest: false,
      guestLocalRecords: false,
    });
  });

  it('renders a published course to a guest', async () => {
    await expect(resolveClassroomPageAccess('stage-1', headers)).resolves.toEqual({
      kind: 'render',
      guest: true,
      guestLocalRecords: true,
    });
  });

  it('redirects a guest away from a private, deleted or unknown course', async () => {
    mocks.access!.isPublic = false;
    await expect(resolveClassroomPageAccess('stage-1', headers)).resolves.toEqual({
      kind: 'redirect',
      next: '/classroom/stage-1',
    });

    mocks.access = null;
    await expect(resolveClassroomPageAccess('nope', headers)).resolves.toEqual({
      kind: 'redirect',
      next: '/classroom/nope',
    });
  });
});
