import { beforeEach, describe, expect, it } from 'vitest';

import { getGuestRecordPolicy, setGuestRecordPolicy } from '@/lib/runtime/guest-records';
import { MemoryRuntimeStore } from '@/lib/runtime/memory-store';

function session(id: string, stageId = 'stage-1', learnerKey = 'anon:one') {
  return {
    id,
    kind: 'chat',
    stageId,
    learnerKey,
    status: 'active' as const,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

beforeEach(() => {
  setGuestRecordPolicy({ guest: false, localRecords: false });
});

describe('guest record policy', () => {
  it('defaults to off and follows the classroom decision', () => {
    expect(getGuestRecordPolicy()).toEqual({ guest: false, localRecords: false });
    setGuestRecordPolicy({ guest: true, localRecords: true });
    expect(getGuestRecordPolicy()).toEqual({ guest: true, localRecords: true });
  });
});

describe('MemoryRuntimeStore', () => {
  it('keeps a session and its records for the lifetime of the object only', async () => {
    const store = new MemoryRuntimeStore();
    await store.createSession(session('s1'));
    await store.appendRecord({ id: 'r1', sessionId: 's1', payload: { role: 'user' } });

    await expect(store.getSession('s1')).resolves.toMatchObject({
      id: 's1',
      runtimeDslVersion: '0.1.0',
    });
    await expect(store.listRecords('s1')).resolves.toMatchObject([
      { id: 'r1', seq: 0, payload: { role: 'user' } },
    ]);
    await expect(store.listSessions('stage-1', 'anon:one')).resolves.toHaveLength(1);
  });

  it('refuses a duplicate session and an append to a closed one', async () => {
    const store = new MemoryRuntimeStore();
    await store.createSession(session('s1'));
    await expect(store.createSession(session('s1'))).rejects.toMatchObject({
      code: 'SESSION_ALREADY_EXISTS',
    });
    await store.setSessionStatus('s1', 'closed', '2026-01-02T00:00:00.000Z');
    await expect(
      store.appendRecord({ id: 'r1', sessionId: 's1', payload: { role: 'user' } }),
    ).rejects.toThrow();
  });

  it('deletes one learner and one stage without touching the rest', async () => {
    const store = new MemoryRuntimeStore();
    await store.createSession(session('a', 'stage-1', 'anon:one'));
    await store.createSession(session('b', 'stage-1', 'anon:two'));
    await store.createSession(session('c', 'stage-2', 'anon:one'));

    await store.deleteLearnerRuntime('stage-1', 'anon:one');
    await expect(store.getSession('a')).resolves.toBeUndefined();
    await expect(store.getSession('b')).resolves.toBeDefined();

    await store.deleteStageRuntime('stage-1');
    await expect(store.getSession('b')).resolves.toBeUndefined();
    await expect(store.getSession('c')).resolves.toBeDefined();
  });
});
