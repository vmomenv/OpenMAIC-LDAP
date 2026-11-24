/**
 * `POST /api/auth/login` — exchange LDAP credentials for an owner session.
 *
 * The session cookie is the only thing the browser keeps: the password is used
 * for one bind and discarded. Failures are deliberately indistinguishable to
 * the client (unknown user, wrong password and a disabled account all answer
 * the same 401), while a directory that cannot be reached answers 503 so the
 * login form can say "try again" instead of "wrong password".
 */
import { isSameOriginJsonRequest } from '@/lib/persistence/owner-claim-http';
import { SlidingWindowFailureLimiter } from '@/lib/server/attempt-limiter';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { clientIdentity } from '@/lib/server/client-identity';
import { clearGuestCookies } from '@/lib/server/identity/classroom-guest/cookies';
import { ldapEnabled, readLdapConfig } from '@/lib/server/identity/ldap/config';
import {
  authenticateLdapUser,
  LdapAuthenticationError,
} from '@/lib/server/identity/ldap/directory';
import { createLdapSession, ldapSessionSetCookie } from '@/lib/server/identity/ldap/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 10 login attempts per username and caller inside 5 minutes. */
const loginAttemptLimiter = new SlidingWindowFailureLimiter({
  maxFailures: 10,
  windowMs: 5 * 60_000,
});

function noStore(response: Response): Response {
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function POST(request: Request) {
  if (!ldapEnabled()) return noStore(new Response('Not found', { status: 404 }));

  if (!isSameOriginJsonRequest(request)) {
    return noStore(apiError('INVALID_REQUEST', 403, 'logins must be same-origin JSON requests'));
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return noStore(apiError('INVALID_REQUEST', 400, 'invalid JSON body'));
  }
  if (typeof body !== 'object' || body === null) {
    return noStore(apiError('INVALID_REQUEST', 400, 'request body must be a JSON object'));
  }
  const { username, password } = body as { username?: unknown; password?: unknown };
  if (
    typeof username !== 'string' ||
    typeof password !== 'string' ||
    username.trim() === '' ||
    password === ''
  ) {
    return noStore(apiError('INVALID_REQUEST', 400, 'username and password are required'));
  }

  const attemptKey = `${clientIdentity(request)}\u0000${username.trim().toLowerCase()}`;
  const limit = loginAttemptLimiter.consume(attemptKey);
  if (limit.limited) {
    const response = apiError('RATE_LIMITED', 429, 'too many login attempts; try again later');
    response.headers.set('Retry-After', String(limit.retryAfterSeconds));
    return noStore(response);
  }

  let identity;
  try {
    identity = await authenticateLdapUser({ username, password }, { config: readLdapConfig() });
  } catch (error) {
    if (error instanceof LdapAuthenticationError) {
      if (error.kind === 'directory-unavailable') {
        console.error('[ldap] the directory could not answer a login', error);
        return noStore(apiError('UPSTREAM_ERROR', 503, 'the directory is unavailable'));
      }
      // Invalid, ambiguous and disabled all look the same to the client.
      return noStore(apiError('INVALID_CREDENTIALS', 401, 'invalid username or password'));
    }
    throw error;
  }

  loginAttemptLimiter.recordSuccess(attemptKey);

  const config = readLdapConfig();
  const { token } = createLdapSession(
    {
      ownerId: identity.ownerId,
      ...(identity.displayName ? { name: identity.displayName } : {}),
    },
    {
      secret: config.sessionSecret,
      ttlSeconds: config.sessionTtlSeconds,
    },
  );

  const response = apiSuccess({
    ok: true,
    user: { name: identity.displayName ?? identity.userId },
  });
  response.headers.append('Set-Cookie', ldapSessionSetCookie(token, config.sessionTtlSeconds));
  // A signed-in account is not a classroom guest: drop the visitor cookies so
  // later requests resolve as the account even on a course link.
  for (const cookie of clearGuestCookies()) response.headers.append('Set-Cookie', cookie);
  return noStore(response);
}
