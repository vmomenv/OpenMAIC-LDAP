/**
 * Guest permission columns on `stage_meta`: defaults, partial updates and
 * idempotent schema upgrades on an existing database.
 */
import { randomUUID } from 'node:crypto';

import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ensureStageMetaSchema,
  readStageMeta,
  setStageGuestPermissions,
} from '@/lib/persistence/stage-meta';

import { boot, courseDocument, storeFor, type ScenarioPool } from './_stage-meta-tenancy-scenarios';

class PGlitePool implements ScenarioPool {
  constructor(readonly db: PGlite) {}

  async query<TRow>(text: string, params?: unknown[]) {
    return (await this.db.query(text, params)) as { rows: TRow[] };
  }

  async connect() {
    return {
      query: (text: string, params?: unknown[]) => this.db.query(text, params),
      release() {},
    };
  }

  async end() {}
}

const OWNER = 'user:alice';

describe('stage_meta guest permissions', () => {
  let db: PGlite;
  let pool: PGlitePool;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('ASSET_S3_BUCKET', '');
    db = new PGlite();
    await db.waitReady;
    pool = new PGlitePool(db);
    await boot(pool, `postgres://guest-permissions-${randomUUID()}`);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await db.close();
  });

  it('defaults to anonymous access off, local records on, other capabilities off', async () => {
    await storeFor(pool, OWNER).saveDocument(courseDocument('stage-defaults') as never);

    const meta = await readStageMeta(pool as never, 'stage-defaults');
    expect(meta).toMatchObject({
      isPublic: false,
      guestQuiz: false,
      guestTts: false,
      guestChat: false,
      guestPbl: false,
      guestLocalRecords: true,
    });
  });

  it('updates only the fields named in the patch', async () => {
    await storeFor(pool, OWNER).saveDocument(courseDocument('stage-patch') as never);

    await setStageGuestPermissions(pool as never, 'stage-patch', {
      guestChat: true,
      guestLocalRecords: false,
    });

    const meta = await readStageMeta(pool as never, 'stage-patch');
    expect(meta).toMatchObject({
      guestQuiz: false,
      guestTts: false,
      guestChat: true,
      guestPbl: false,
      guestLocalRecords: false,
    });
  });

  it('re-running the schema upgrade leaves the chosen permissions in place', async () => {
    await storeFor(pool, OWNER).saveDocument(courseDocument('stage-idempotent') as never);
    await setStageGuestPermissions(pool as never, 'stage-idempotent', { guestPbl: true });

    await ensureStageMetaSchema(pool as never);

    const meta = await readStageMeta(pool as never, 'stage-idempotent');
    expect(meta).toMatchObject({ guestPbl: true, guestLocalRecords: true });
  });
});
