/**
 * Anonymous-visitor cookies for a classroom opened by link or QR code in an
 * LDAP deployment.
 *
 * The middleware mints these on a `/classroom/*` document request that carries
 * no live LDAP session. They grant no course access by themselves: the page
 * (Node) decides whether the course is published, and every guest read and
 * capability re-checks that in the database. The cookies only name the guest
 * and remember which course is on screen.
 */
import { cookiesAreSecure } from '@/lib/server/cookie-secure';

/** Non-HttpOnly hint the browser reads to pick local record storage. */
export const GUEST_COOKIE = 'openmaic_guest';

/** HttpOnly anonymous owner id (`classroom-guest:<uuid>`). */
export const GUEST_OWNER_COOKIE = 'openmaic_guest_owner';

/** Non-HttpOnly: the most recent classroom, used when no Referer says. */
export const GUEST_STAGE_COOKIE = 'openmaic_guest_stage';

const GUEST_OWNER = /^classroom-guest:[0-9a-f-]{36}$/;
const STAGE_ID = /^[A-Za-z0-9_-]{1,200}$/;

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    return value === '' ? undefined : value;
  }
  return undefined;
}

export function isGuestRequest(headers: Headers): boolean {
  return readCookie(headers.get('cookie'), GUEST_COOKIE) === '1';
}

/** The guest owner id, or `undefined` when the cookie is absent or malformed. */
export function readGuestOwner(headers: Headers): string | undefined {
  const ownerId = readCookie(headers.get('cookie'), GUEST_OWNER_COOKIE);
  return ownerId && GUEST_OWNER.test(ownerId) ? ownerId : undefined;
}

/** A fresh guest owner id, used when the middleware mints the cookies. */
export function mintGuestOwnerId(): string {
  return `classroom-guest:${crypto.randomUUID()}`;
}

export function isValidStageId(stageId: string): boolean {
  return STAGE_ID.test(stageId);
}

/** `Set-Cookie` values that establish guest mode for this browser. */
export function guestSetCookies(ownerId: string): string[] {
  const secure = cookiesAreSecure() ? '; Secure' : '';
  return [
    `${GUEST_COOKIE}=1; Path=/; SameSite=Lax${secure}`,
    `${GUEST_OWNER_COOKIE}=${ownerId}; Path=/; HttpOnly; SameSite=Lax${secure}`,
  ];
}

/** `Set-Cookie` values that remember the classroom a guest is looking at. */
export function guestStageCookie(stageId: string): string {
  const secure = cookiesAreSecure() ? '; Secure' : '';
  return `${GUEST_STAGE_COOKIE}=${stageId}; Path=/; SameSite=Lax${secure}`;
}

/** `Set-Cookie` values that drop guest mode (after sign-in or sign-out). */
export function clearGuestCookies(): string[] {
  const secure = cookiesAreSecure() ? '; Secure' : '';
  return [GUEST_COOKIE, GUEST_OWNER_COOKIE, GUEST_STAGE_COOKIE].map(
    (name) => `${name}=; Path=/; Max-Age=0; SameSite=Lax${secure}`,
  );
}
