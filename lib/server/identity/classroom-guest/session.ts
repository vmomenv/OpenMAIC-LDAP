/**
 * Whether a request also carries a live LDAP account session.
 *
 * Kept apart from `./access.ts` so the guest auth method (imported by
 * `instrumentation.ts`) does not pull the database-backed course access
 * layer, and its Node-only dependencies, into the Edge instrumentation bundle.
 */
import { ldapEnabled, readLdapConfig } from '../ldap/config';
import { readLdapSessionToken, verifyLdapSession } from '../ldap/session';

export function hasLiveLdapSession(headers: Headers, secret?: string): boolean {
  if (!ldapEnabled()) return false;
  const token = readLdapSessionToken(headers);
  if (!token) return false;
  try {
    const sessionSecret = secret ?? readLdapConfig().sessionSecret;
    return verifyLdapSession(token, { secret: sessionSecret }) !== null;
  } catch {
    // An incomplete LDAP configuration fails the boot; a request that somehow
    // arrives anyway must not be treated as a signed-in account.
    return false;
  }
}
