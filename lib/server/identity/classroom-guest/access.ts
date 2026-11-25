/**
 * Server-side checks for an anonymous classroom visitor.
 *
 * A guest cookie is not a course capability: these checks re-read the course
 * on every request, so unpublishing the course or turning a capability off
 * takes effect immediately. Signed-in LDAP users skip them.
 */
import { resolveStageAccess } from '@/lib/server/stage-access';
import type { OwnerPrincipal } from '../types';
import { ldapEnabled } from '../ldap/config';
import { isValidStageId, isGuestRequest, readGuestOwner } from './cookies';
import { hasLiveLdapSession } from './session';

export type GuestCapability = 'quiz' | 'tts' | 'chat' | 'pbl';

interface GuestCheckRequest {
  readonly headers: Headers;
  readonly url?: string;
}

/** Whether this request resolved as an anonymous classroom visitor. */
export function isClassroomGuest(principal: Pick<OwnerPrincipal, 'channel'>): boolean {
  return principal.channel === 'classroom-guest';
}

/** The course whose classroom is on screen, from header, Referer or cookie. */
export function readGuestStageContext(req: GuestCheckRequest): string | undefined {
  const explicit = req.headers.get('x-openmaic-classroom')?.trim();
  if (explicit && isValidStageId(explicit)) return explicit;

  const referer = req.headers.get('referer');
  if (referer) {
    try {
      const match = /\/classroom\/([A-Za-z0-9_-]+)(?:\/|$)/.exec(new URL(referer).pathname);
      if (match?.[1] && isValidStageId(match[1])) return match[1];
    } catch {
      // A malformed Referer falls through to the cookie.
    }
  }

  if (!req.url) return undefined;
  const cookie = req.headers.get('cookie');
  if (!cookie) return undefined;
  for (const part of cookie.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== 'openmaic_guest_stage') continue;
    const value = part.slice(separator + 1).trim();
    if (value && isValidStageId(value)) return value;
  }
  return undefined;
}

function disabled(message: string): Response {
  return Response.json(
    { error: { code: 'GUEST_CAPABILITY_DISABLED', message } },
    { status: 403 },
  );
}

/**
 * Refuse the request unless this is a signed-in user, or a guest of a
 * published course with `capability` enabled. `undefined` means allowed.
 */
export async function assertGuestCapability(
  req: GuestCheckRequest,
  capability: GuestCapability,
): Promise<Response | undefined> {
  if (!ldapEnabled()) return undefined;
  if (hasLiveLdapSession(req.headers)) return undefined;
  if (!isGuestRequest(req.headers)) {
    return Response.json(
      { error: { code: 'INVALID_CREDENTIAL', message: 'authentication required' } },
      { status: 401 },
    );
  }
  if (!readGuestOwner(req.headers)) {
    return Response.json(
      { error: { code: 'INVALID_CREDENTIAL', message: 'authentication required' } },
      { status: 401 },
    );
  }

  const stageId = readGuestStageContext(req);
  if (!stageId) return disabled('this request does not name a classroom');

  const access = await resolveStageAccess(stageId);
  if (!access || access.deletedAt !== null || !access.isPublic) {
    return disabled('this course is not open to visitors');
  }

  const allowed =
    capability === 'quiz'
      ? access.guestQuiz
      : capability === 'tts'
        ? access.guestTts
        : capability === 'chat'
          ? access.guestChat
          : access.guestPbl;
  return allowed ? undefined : disabled('this activity is disabled for visitors');
}

/**
 * Whether an anonymous visitor may read this course's document or media.
 * Published courses only; a deleted or private course answers exactly like an
 * unknown id.
 */
export async function isStageReadableByGuest(stageId: string): Promise<boolean> {
  if (!ldapEnabled()) return true;
  const access = await resolveStageAccess(stageId);
  return access !== null && access.deletedAt === null && access.isPublic;
}
