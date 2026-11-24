import { DocumentNotFoundError } from '@openmaic/storage';
import type { Queryable } from '@openmaic/storage/document/pg';
import { applySchemaMigrations, type SchemaMigrationSet } from '@openmaic/storage/pg-migrations';

import { ensureLegacyImportBindingSchema } from './legacy-import-bindings';
import { ensureOwnerMergeSchema } from './owner-merges';

/** What an anonymous visitor may do inside a published course. */
export interface GuestPermissions {
  guestQuiz: boolean;
  guestTts: boolean;
  guestChat: boolean;
  guestPbl: boolean;
  guestLocalRecords: boolean;
}

export interface StageMetaRow extends GuestPermissions {
  stageId: string;
  ownerId: string;
  isPublic: boolean;
  /** Epoch millis when the owner published the course; null while private. */
  publishedAt: number | null;
  /** Server-side mirror of the document outline's generation-complete flag. */
  generationComplete: boolean;
  deletedAt: Date | null;
}

interface RawStageMetaRow extends Record<string, unknown> {
  stage_id: string;
  owner_id: string;
  is_public: boolean;
  published_at: number | string | null;
  generation_complete: boolean;
  guest_quiz: boolean;
  guest_tts: boolean;
  guest_chat: boolean;
  guest_pbl: boolean;
  guest_local_records: boolean;
  deleted_at: Date | string | null;
}

export const STAGE_META_SCHEMA = `
CREATE TABLE IF NOT EXISTS stage_meta (
  stage_id TEXT PRIMARY KEY REFERENCES document_stages(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  is_public BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ
);

ALTER TABLE stage_meta
  ADD COLUMN IF NOT EXISTS published_at DOUBLE PRECISION;

ALTER TABLE stage_meta
  ADD COLUMN IF NOT EXISTS generation_complete BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS stage_meta_owner_idx ON stage_meta (owner_id, stage_id);

CREATE INDEX IF NOT EXISTS stage_meta_public_live_idx
  ON stage_meta (stage_id) WHERE is_public AND deleted_at IS NULL;
`;

/** Whether `document_stages` still has the retired `owner_id` column. */
async function hasLegacyDocumentOwnerColumn(queryable: Queryable): Promise<boolean> {
  const result = await queryable.query<{ present: boolean } & Record<string, unknown>>(
    `SELECT EXISTS (
       SELECT 1
         FROM pg_attribute
        WHERE attrelid = to_regclass('document_stages')
          AND attname = 'owner_id'
          AND NOT attisdropped
     ) AS present`,
  );
  return result.rows[0]?.present === true;
}

/** What {@link adoptLegacyDocumentOwners} found; all zero on a database without the column. */
export interface LegacyOwnerAdoption {
  /** Courses whose only ownership record was the document row, now in `stage_meta`. */
  adopted: number;
  /** Courses whose document row names a different owner than `stage_meta`, which wins. */
  disagreeing: number;
}

/**
 * Copy ownership recorded only on `document_stages.owner_id` into
 * `stage_meta`.
 *
 * Nothing reads that column any more -- `stage_meta` is the only ownership
 * record -- so a course written before `stage_meta` existed, whose owner is
 * on its document row alone, would otherwise belong to no one. Idempotent: an
 * existing ownership row is never touched (`ON CONFLICT DO NOTHING`), so a
 * second boot adopts nothing, and where the two records disagree `stage_meta`
 * stands and the disagreement is counted for an operator. A database created
 * without the column has nothing to adopt. Runs once per database, as
 * migration 2 of `stage-meta`.
 */
export async function adoptLegacyDocumentOwners(
  queryable: Queryable,
): Promise<LegacyOwnerAdoption> {
  if (!(await hasLegacyDocumentOwnerColumn(queryable))) return { adopted: 0, disagreeing: 0 };
  const adopted = await queryable.query<{ stage_id: string } & Record<string, unknown>>(
    `INSERT INTO stage_meta (stage_id, owner_id)
     SELECT id, owner_id
       FROM document_stages
      WHERE owner_id IS NOT NULL
     ON CONFLICT (stage_id) DO NOTHING
     RETURNING stage_id`,
  );
  const disagreeing = await queryable.query<{ count: string } & Record<string, unknown>>(
    `SELECT COUNT(*)::text AS count
       FROM document_stages AS stages
       JOIN stage_meta AS meta ON meta.stage_id = stages.id
      WHERE stages.owner_id IS NOT NULL
        AND stages.owner_id <> meta.owner_id`,
  );
  return {
    adopted: adopted.rows.length,
    disagreeing: Number(disagreeing.rows[0]?.count ?? 0),
  };
}

/**
 * Version 2: adopt owned documents that have no ownership row.
 *
 * The adoption ({@link adoptLegacyDocumentOwners}) is a backfill for databases
 * written before `stage_meta` existed, and must run before anything serves a
 * course: nothing else reads the owner recorded on a document row. It runs
 * once per database, at provider startup and outside any request, so it
 * records ownership **without** the host create hooks (`authorizeCreate` /
 * `onCreate`): there is no request, principal, or create transaction to run
 * them in. Releases from 1.1.x on record every course they create in
 * `stage_meta` as well, and adopt column-only owners on their own starts, so
 * nothing written after this ran needs it again. When it does adopt, it says
 * how many so an operator can reconcile any host rows those courses lack.
 */
async function adoptLegacyDocumentOwnersOnce(queryable: Queryable): Promise<void> {
  const { adopted, disagreeing } = await adoptLegacyDocumentOwners(queryable);
  if (adopted > 0) {
    console.warn(
      `[stage-meta] adopted ${adopted} owned course(s) without an ownership row; ` +
        'host create hooks do not run for adopted courses.',
    );
  }
  if (disagreeing > 0) {
    console.warn(
      `[stage-meta] ${disagreeing} course(s) name a different owner on the retired ` +
        'document_stages.owner_id column than in stage_meta; stage_meta is authoritative.',
    );
  }
}

/**
 * Version 3: the per-course capabilities an anonymous visitor gets once the
 * course is published. `is_public` remains the master switch (sharing the
 * course publishes it); these columns only narrow what a guest may do.
 * `guest_local_records` is on by default because the classroom writes a
 * visitor's records to their own browser, not to the server.
 */
export const GUEST_PERMISSIONS_SCHEMA = `
ALTER TABLE stage_meta
  ADD COLUMN IF NOT EXISTS guest_quiz BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE stage_meta
  ADD COLUMN IF NOT EXISTS guest_tts BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE stage_meta
  ADD COLUMN IF NOT EXISTS guest_chat BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE stage_meta
  ADD COLUMN IF NOT EXISTS guest_pbl BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE stage_meta
  ADD COLUMN IF NOT EXISTS guest_local_records BOOLEAN NOT NULL DEFAULT true;
`;

export const STAGE_META_MIGRATIONS: SchemaMigrationSet = {
  store: 'stage-meta',
  migrations: [
    { version: 1, name: 'baseline', up: STAGE_META_SCHEMA, transaction: false },
    { version: 2, name: 'adopt_legacy_document_owners', up: adoptLegacyDocumentOwnersOnce },
    { version: 3, name: 'guest_permissions', up: GUEST_PERMISSIONS_SCHEMA, transaction: false },
  ],
};

/** Ensure the schema of course ownership, the claim records and the import bindings. */
export async function ensureStageMetaSchema(queryable: Queryable): Promise<void> {
  await applySchemaMigrations(queryable, STAGE_META_MIGRATIONS);
  // The record of ownership moving between owners (claims), provisioned with
  // the record of ownership itself: every write path that checks one reads
  // the other (see ./owner-merges.ts).
  await ensureOwnerMergeSchema(queryable);
  // Which owner a browser's pre-server data belongs to: a claim moves these
  // with the rest of the owner's rows (see ./legacy-import-bindings.ts).
  await ensureLegacyImportBindingSchema(queryable);
}

export async function readStageMeta(
  queryable: Queryable,
  stageId: string,
): Promise<StageMetaRow | null> {
  const result = await queryable.query<RawStageMetaRow>(
    `SELECT stage_id, owner_id, is_public, published_at, generation_complete,
            guest_quiz, guest_tts, guest_chat, guest_pbl, guest_local_records,
            deleted_at
       FROM stage_meta
      WHERE stage_id = $1`,
    [stageId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const publishedAt = row.published_at;
  return {
    stageId: row.stage_id,
    ownerId: row.owner_id,
    isPublic: row.is_public === true,
    publishedAt:
      publishedAt === null
        ? null
        : typeof publishedAt === 'number'
          ? publishedAt
          : Number(publishedAt),
    generationComplete: row.generation_complete === true,
    guestQuiz: row.guest_quiz === true,
    guestTts: row.guest_tts === true,
    guestChat: row.guest_chat === true,
    guestPbl: row.guest_pbl === true,
    guestLocalRecords: row.guest_local_records === true,
    deletedAt:
      row.deleted_at === null
        ? null
        : row.deleted_at instanceof Date
          ? row.deleted_at
          : new Date(row.deleted_at),
  };
}

export type StageAccessRefusal = 'foreign' | 'unclaimed' | 'tombstoned' | 'reserved-document';

export class StageAccessError extends DocumentNotFoundError {
  constructor(
    stageId: string,
    readonly attemptedBy: string,
    readonly refusal: StageAccessRefusal,
  ) {
    super(stageId, `stage access refused (${refusal}) for ${JSON.stringify(stageId)}`);
    (this as { name: string }).name = 'StageAccessError';
  }
}

/**
 * Record that `ownerId` owns `stageId`. Resolves `true` when this call inserted
 * the ownership row -- the course was created by the calling transaction --
 * and `false` when the owner already held it (a concurrent create by the same
 * owner that committed first). A foreign owner is refused.
 */
export async function claimStageMeta(
  queryable: Queryable,
  stageId: string,
  ownerId: string,
): Promise<boolean> {
  const inserted = await queryable.query<{ owner_id: string } & Record<string, unknown>>(
    `INSERT INTO stage_meta (stage_id, owner_id)
     VALUES ($1, $2)
     ON CONFLICT (stage_id) DO NOTHING
     RETURNING owner_id`,
    [stageId, ownerId],
  );
  if (inserted.rows[0]?.owner_id === ownerId) return true;

  const existing = await queryable.query<{ owner_id: string } & Record<string, unknown>>(
    'SELECT owner_id FROM stage_meta WHERE stage_id = $1',
    [stageId],
  );
  if (existing.rows[0]?.owner_id !== ownerId) {
    throw new StageAccessError(stageId, ownerId, 'foreign');
  }
  return false;
}

export async function tombstoneStageMeta(queryable: Queryable, stageId: string): Promise<void> {
  await queryable.query(
    `UPDATE stage_meta
        SET deleted_at = CURRENT_TIMESTAMP
      WHERE stage_id = $1 AND deleted_at IS NULL`,
    [stageId],
  );
}

/** Monotonically mark a live course's server-side generation-complete flag. */
export async function markStageGenerationComplete(
  queryable: Queryable,
  stageId: string,
): Promise<boolean> {
  const result = await queryable.query<{ stage_id: string } & Record<string, unknown>>(
    `UPDATE stage_meta
        SET generation_complete = true
      WHERE stage_id = $1 AND deleted_at IS NULL
      RETURNING stage_id`,
    [stageId],
  );
  return result.rows.length === 1;
}

const GUEST_PERMISSION_COLUMNS: Record<keyof GuestPermissions, string> = {
  guestQuiz: 'guest_quiz',
  guestTts: 'guest_tts',
  guestChat: 'guest_chat',
  guestPbl: 'guest_pbl',
  guestLocalRecords: 'guest_local_records',
};

/**
 * Update only the guest capabilities named in `patch` on a live course.
 * Absent keys are left alone, so the UI can flip one checkbox at a time.
 * Unknown keys are ignored by construction (the map above is the vocabulary).
 */
export async function setStageGuestPermissions(
  queryable: Queryable,
  stageId: string,
  patch: Partial<GuestPermissions>,
): Promise<void> {
  const assignments: string[] = [];
  const params: unknown[] = [stageId];
  for (const [key, column] of Object.entries(GUEST_PERMISSION_COLUMNS)) {
    const value = patch[key as keyof GuestPermissions];
    if (value === undefined) continue;
    params.push(value);
    assignments.push(`${column} = $${params.length}`);
  }
  if (assignments.length === 0) return;
  await queryable.query(
    `UPDATE stage_meta
        SET ${assignments.join(', ')}
      WHERE stage_id = $1 AND deleted_at IS NULL`,
    params,
  );
}

/** Publish (isPublic=true, publishedAt set) or unpublish (isPublic=false, publishedAt cleared). */
export async function setStagePublished(
  queryable: Queryable,
  stageId: string,
  isPublic: boolean,
  publishedAt: number | null,
): Promise<void> {
  await queryable.query(
    `UPDATE stage_meta
        SET is_public = $2, published_at = $3
      WHERE stage_id = $1 AND deleted_at IS NULL`,
    [stageId, isPublic, publishedAt],
  );
}
