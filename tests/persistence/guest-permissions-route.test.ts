import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  persistenceConfigured: true,
  resolveRequestOwnerId: vi.fn(),
  access: null as Record<string, unknown> | null,
  setPermissions: vi.fn(),
}));

vi.mock('@/lib/config/feature-flags', () => ({
  isServerPersistenceConfigured: () => mocks.persistenceConfigured,
}));
vi.mock('@/lib/server/identity/resolve', async () =>
  (await import('../helpers/owner-resolution-mock')).ownerResolveModule(
    mocks.resolveRequestOwnerId,
  ),
);
vi.mock('@/lib/server/stage-access', () => ({
  getStageAccessDb: async () => ({ query: vi.fn() }),
  resolveStageAccess: async () => mocks.access,
}));
vi.mock('@/lib/persistence/stage-meta', () => ({
  setStageGuestPermissions: mocks.setPermissions,
}));

import { PATCH } from '@/app/api/stages/[id]/guest-permissions/route';

const STAGE_ID = 'stage-1';
const params = { params: Promise.resolve({ id: STAGE_ID }) };

function request(body: unknown) {
  return new NextRequest(`http://localhost/api/stages/${STAGE_ID}/guest-permissions`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.persistenceConfigured = true;
  mocks.resolveRequestOwnerId.mockReturnValue('owner-1');
  mocks.access = {
    stageId: STAGE_ID,
    ownerId: 'owner-1',
    name: 'Course',
    isPublic: true,
    publishedAt: 1,
    generationComplete: true,
    guestQuiz: false,
    guestTts: false,
    guestChat: false,
    guestPbl: false,
    guestLocalRecords: true,
    source: 'document',
    deletedAt: null,
  };
});

describe('PATCH /api/stages/[id]/guest-permissions', () => {
  it('updates the named capabilities for the owner', async () => {
    const response = await PATCH(request({ guestChat: true, guestLocalRecords: false }), params);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      permissions: { guestChat: true, guestLocalRecords: false, guestQuiz: false },
    });
    expect(mocks.setPermissions).toHaveBeenCalledWith(expect.anything(), STAGE_ID, {
      guestChat: true,
      guestLocalRecords: false,
    });
  });

  it('refuses a foreign owner with 403', async () => {
    mocks.access!.ownerId = 'owner-2';
    const response = await PATCH(request({ guestChat: true }), params);
    expect(response.status).toBe(403);
    expect(mocks.setPermissions).not.toHaveBeenCalled();
  });

  it('asks an anonymous caller to sign in', async () => {
    mocks.resolveRequestOwnerId.mockReturnValue('anon:browser');
    const response = await PATCH(request({ guestChat: true }), params);
    expect(response.status).toBe(401);
  });

  it('rejects a non-boolean value', async () => {
    const response = await PATCH(request({ guestChat: 'yes' }), params);
    expect(response.status).toBe(400);
    expect(mocks.setPermissions).not.toHaveBeenCalled();
  });

  it('answers 404 for a deleted or absent course', async () => {
    mocks.access = null;
    const response = await PATCH(request({ guestChat: true }), params);
    expect(response.status).toBe(404);
  });
});
