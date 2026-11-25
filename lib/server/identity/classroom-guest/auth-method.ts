/**
 * The `classroom-guest` owner auth method: any visitor the middleware marked
 * as a guest, on the classroom API surface only.
 *
 * It declines when a live LDAP session is present, so a signed-in user with a
 * leftover guest cookie still resolves as themselves. LDAP is registered after
 * this method, but the explicit check is what makes an expired LDAP cookie
 * fall back to guest mode instead of refusing the request.
 */
import type { OwnerAuthMethod, OwnerPrincipal } from '../types';
import { isGuestRequest, readGuestOwner } from './cookies';
import { isGuestAllowedApiPath } from './paths';
import { hasLiveLdapSession } from './session';

export interface ClassroomGuestAuthOptions {
  /** Signing secret of the deployment's LDAP sessions. */
  readonly ldapSessionSecret: string;
}

export function classroomGuestAuthMethod(
  options: ClassroomGuestAuthOptions,
): OwnerAuthMethod {
  return {
    name: 'classroom-guest',
    async authenticate(req) {
      if (!req.url) return { status: 'not-applicable' };
      let pathname: string;
      try {
        pathname = new URL(req.url, 'http://localhost').pathname;
      } catch {
        return { status: 'not-applicable' };
      }
      if (!isGuestAllowedApiPath(pathname, req.method)) {
        return { status: 'not-applicable' };
      }
      if (!isGuestRequest(req.headers)) return { status: 'not-applicable' };
      const ownerId = readGuestOwner(req.headers);
      if (!ownerId) return { status: 'not-applicable' };
      if (hasLiveLdapSession(req.headers, options.ldapSessionSecret)) {
        return { status: 'not-applicable' };
      }

      const principal: OwnerPrincipal = {
        ownerId,
        kind: 'anonymous',
        roles: new Set(),
        assurance: 'minted',
        channel: 'classroom-guest',
      };
      return { status: 'authenticated', principal };
    },
    describeStoredOwner(ownerId) {
      return ownerId.startsWith('classroom-guest:') ? { kind: 'anonymous' } : undefined;
    },
  };
}
