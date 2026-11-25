/**
 * Whether `/classroom/[id]` may render for this request.
 *
 * The middleware lets a classroom page through so it can read the course's
 * published state here, in Node, where the database is reachable. Private
 * courses keep the old "sign in first" behaviour and do not reveal whether the
 * id exists.
 */
import { hasLiveLdapSession } from '@/lib/server/identity/classroom-guest/session';
import { ldapEnabled } from '@/lib/server/identity/ldap/config';
import { resolveStageAccess } from '@/lib/server/stage-access';

export type ClassroomPageAccess =
  | { kind: 'render'; guest: boolean; guestLocalRecords: boolean }
  | { kind: 'redirect'; next: string };

export async function resolveClassroomPageAccess(
  classroomId: string,
  headers: Headers,
): Promise<ClassroomPageAccess> {
  if (!ldapEnabled() || hasLiveLdapSession(headers)) {
    return { kind: 'render', guest: false, guestLocalRecords: false };
  }

  const access = await resolveStageAccess(classroomId);
  if (!access || access.deletedAt !== null || !access.isPublic) {
    return { kind: 'redirect', next: `/classroom/${encodeURIComponent(classroomId)}` };
  }
  return { kind: 'render', guest: true, guestLocalRecords: access.guestLocalRecords };
}
