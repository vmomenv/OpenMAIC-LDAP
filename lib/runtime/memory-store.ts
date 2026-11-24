/**
 * An ephemeral RuntimeStore for anonymous classroom visitors whose teacher
 * turned "save my records in this browser" off.
 *
 * The classroom still needs somewhere to keep a session and its records while
 * the tab is open, but nothing may survive a reload and nothing may reach the
 * server. A plain in-memory implementation is the honest backend: it has the
 * same contract, ignores durability on purpose, and is discarded with the page.
 */
import { RUNTIME_DSL_VERSION } from '@openmaic/dsl';
import type {
  RuntimePayload,
  RuntimeRecord,
  RuntimeRecordInit,
  RuntimeSession,
  RuntimeSessionStatus,
} from '@openmaic/dsl';
import {
  RuntimeAppendConflictError,
  RuntimeSessionExistsError,
  type RuntimeAppendOptions,
  type RuntimeSessionInit,
  type RuntimeStore,
  type RuntimeTailOptions,
} from '@openmaic/storage';

interface StoredSession {
  session: RuntimeSession;
  records: RuntimeRecord[];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryRuntimeStore implements RuntimeStore {
  private readonly sessions = new Map<string, StoredSession>();

  async createSession(init: RuntimeSessionInit): Promise<RuntimeSession> {
    if (this.sessions.has(init.id)) throw new RuntimeSessionExistsError(init.id);
    const session: RuntimeSession = {
      ...clone(init),
      runtimeDslVersion: RUNTIME_DSL_VERSION,
    };
    this.sessions.set(session.id, { session, records: [] });
    return clone(session);
  }

  async getSession(sessionId: string): Promise<RuntimeSession | undefined> {
    const entry = this.sessions.get(sessionId);
    return entry ? clone(entry.session) : undefined;
  }

  async listSessions(stageId: string, learnerKey: string): Promise<RuntimeSession[]> {
    return [...this.sessions.values()]
      .filter(
        (entry) =>
          entry.session.stageId === stageId && entry.session.learnerKey === learnerKey,
      )
      .map((entry) => clone(entry.session))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async setSessionStatus(
    sessionId: string,
    status: RuntimeSessionStatus,
    updatedAt: string,
    options?: RuntimeTailOptions,
  ): Promise<void> {
    const entry = this.requireSession(sessionId, options?.expectedLastSeq);
    entry.session = { ...entry.session, status, updatedAt };
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async appendRecord<TPayload extends RuntimePayload>(
    init: RuntimeRecordInit<TPayload>,
    options?: RuntimeAppendOptions,
  ): Promise<RuntimeRecord<TPayload>> {
    const entry = this.requireSession(init.sessionId, options?.expectedLastSeq);
    if (entry.session.status !== 'active') {
      throw new Error(`session ${JSON.stringify(init.sessionId)} is not active`);
    }
    const record: RuntimeRecord<TPayload> = {
      ...clone(init),
      seq: entry.records.length,
    } as RuntimeRecord<TPayload>;
    entry.records.push(record as RuntimeRecord);
    if (options?.sessionTransition) {
      entry.session = {
        ...entry.session,
        status: options.sessionTransition.status,
        updatedAt: options.sessionTransition.updatedAt,
      };
    }
    return clone(record);
  }

  async listRecords(
    sessionId: string,
    opts?: { sceneId?: string },
  ): Promise<RuntimeRecord[]> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return [];
    const records = opts?.sceneId
      ? entry.records.filter((record) => record.sceneId === opts.sceneId)
      : entry.records;
    return records.map((record) => clone(record));
  }

  async mergeLearner(fromLearnerKey: string, toLearnerKey: string): Promise<number> {
    if (!fromLearnerKey || !toLearnerKey) throw new Error('a learner key is required');
    if (fromLearnerKey === toLearnerKey) return 0;
    let moved = 0;
    for (const entry of this.sessions.values()) {
      if (entry.session.learnerKey !== fromLearnerKey) continue;
      entry.session = { ...entry.session, learnerKey: toLearnerKey };
      moved += 1;
    }
    return moved;
  }

  async deleteLearnerRuntime(stageId: string, learnerKey: string): Promise<void> {
    for (const [id, entry] of this.sessions) {
      if (entry.session.stageId === stageId && entry.session.learnerKey === learnerKey) {
        this.sessions.delete(id);
      }
    }
  }

  async deleteStageRuntime(stageId: string): Promise<void> {
    for (const [id, entry] of this.sessions) {
      if (entry.session.stageId === stageId) this.sessions.delete(id);
    }
  }

  async deleteAllRuntime(): Promise<void> {
    this.sessions.clear();
  }

  private requireSession(sessionId: string, expectedLastSeq?: number | null): StoredSession {
    const entry = this.sessions.get(sessionId);
    if (!entry) throw new Error(`session ${JSON.stringify(sessionId)} is not stored`);
    if (expectedLastSeq !== undefined) {
      const actual = entry.records.length === 0 ? null : entry.records.length - 1;
      if (actual !== expectedLastSeq) {
        throw new RuntimeAppendConflictError(sessionId, expectedLastSeq, actual);
      }
    }
    return entry;
  }
}
