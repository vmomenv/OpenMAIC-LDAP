/**
 * PATCH /api/stages/[id]/guest-permissions — which capabilities unknown
 * visitors get once the course is published. Owner-only, and only for a
 * principal holding the `course:publish` role, exactly like publish/unpublish.
 *
 * The master switch is still `is_public` (`POST /publish`): these flags only
 * narrow what a guest may do inside a published course. Unpublishing keeps
 * them so republishing restores the teacher's choices.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import {
  setStageGuestPermissions,
  type GuestPermissions,
} from '@/lib/persistence/stage-meta';
import { getStageAccessDb, resolveStageAccess } from '@/lib/server/stage-access';
import { OWNER_ROLES, principalHasRole } from '@/lib/server/identity/types';
import { withRequestOwner } from '@/lib/server/identity/with-owner';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

const PERMISSION_KEYS = [
  'guestQuiz',
  'guestTts',
  'guestChat',
  'guestPbl',
  'guestLocalRecords',
] as const satisfies readonly (keyof GuestPermissions)[];

function readPatch(body: unknown): Partial<GuestPermissions> | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined;
  const patch: Partial<GuestPermissions> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!(PERMISSION_KEYS as readonly string[]).includes(key)) return undefined;
    if (typeof value !== 'boolean') return undefined;
    patch[key as keyof GuestPermissions] = value;
  }
  return patch;
}

function permissionsOf(
  access: NonNullable<Awaited<ReturnType<typeof resolveStageAccess>>>,
  patch: Partial<GuestPermissions>,
): GuestPermissions {
  return {
    guestQuiz: patch.guestQuiz ?? access.guestQuiz,
    guestTts: patch.guestTts ?? access.guestTts,
    guestChat: patch.guestChat ?? access.guestChat,
    guestPbl: patch.guestPbl ?? access.guestPbl,
    guestLocalRecords: patch.guestLocalRecords ?? access.guestLocalRecords,
  };
}

export async function PATCH(req: NextRequest, { params }: Params) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  const patch = readPatch(body);
  if (!patch) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  return withRequestOwner(req, async (principal, responseHeaders) => {
    const { id: stageId } = await params;
    try {
      if (!principalHasRole(principal, OWNER_ROLES.coursePublish)) {
        return principal.kind === 'anonymous'
          ? NextResponse.json(
              { error: 'login_required' },
              { status: 401, headers: responseHeaders },
            )
          : NextResponse.json(
              { error: 'forbidden' },
              { status: 403, headers: responseHeaders },
            );
      }

      const access = await resolveStageAccess(stageId);
      if (!access) {
        return NextResponse.json(
          { error: 'not_found' },
          { status: 404, headers: responseHeaders },
        );
      }
      if (access.ownerId !== principal.ownerId) {
        return NextResponse.json(
          { error: 'forbidden' },
          { status: 403, headers: responseHeaders },
        );
      }

      const db = await getStageAccessDb();
      await setStageGuestPermissions(db as never, stageId, patch);

      return NextResponse.json(
        { success: true, permissions: permissionsOf(access, patch) },
        { status: 200, headers: responseHeaders },
      );
    } catch (error) {
      console.error('Failed to update guest permissions', {
        stageId,
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json(
        { error: 'internal_error' },
        { status: 500, headers: responseHeaders },
      );
    }
  });
}
