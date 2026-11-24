import { describe, expect, it } from 'vitest';

import { decideDocumentAccess } from '@/lib/persistence/document-access';
import type { StageMetaRow } from '@/lib/persistence/stage-meta';

function meta(overrides: Partial<StageMetaRow> = {}): StageMetaRow {
  return {
    stageId: 'stage-1',
    ownerId: 'ldap:teacher',
    isPublic: true,
    publishedAt: 1,
    generationComplete: true,
    guestQuiz: false,
    guestTts: false,
    guestChat: false,
    guestPbl: false,
    guestLocalRecords: true,
    deletedAt: null,
    ...overrides,
  };
}

const readMeta = async () => meta();
const exists = async () => true;

describe('decideDocumentAccess for anonymous visitors', () => {
  it('allows a published course', async () => {
    await expect(
      decideDocumentAccess({ kind: 'read', stageId: 'stage-1' }, 'classroom-guest:x', readMeta, exists, readMeta, {
        publicOnlyRead: true,
      }),
    ).resolves.toBe('allow');
  });

  it('hides a private course exactly like a missing one', async () => {
    await expect(
      decideDocumentAccess(
        { kind: 'read', stageId: 'stage-1' },
        'classroom-guest:x',
        async () => meta({ isPublic: false }),
        exists,
        async () => meta({ isPublic: false }),
        { publicOnlyRead: true },
      ),
    ).resolves.toBe('not-found');
  });

  it('keeps the capability-by-id read for account owners', async () => {
    await expect(
      decideDocumentAccess(
        { kind: 'read', stageId: 'stage-1' },
        'ldap:other',
        async () => meta({ isPublic: false }),
        exists,
        async () => meta({ isPublic: false }),
      ),
    ).resolves.toBe('allow');
  });
});
