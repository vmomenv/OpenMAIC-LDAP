/**
 * `POST /api/auth/logout` — drop the LDAP session cookie.
 *
 * Same-origin JSON only, like login: a cross-site page must not be able to
 * sign a visitor out (a petty but real nuisance), and the cookie is HttpOnly,
 * so only this server can clear it.
 */
import { isSameOriginJsonRequest } from '@/lib/persistence/owner-claim-http';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { clearGuestCookies } from '@/lib/server/identity/classroom-guest/cookies';
import { ldapEnabled } from '@/lib/server/identity/ldap/config';
import { clearLdapSessionCookie } from '@/lib/server/identity/ldap/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!ldapEnabled()) return new Response('Not found', { status: 404 });
  if (!isSameOriginJsonRequest(request)) {
    return apiError('INVALID_REQUEST', 403, 'logouts must be same-origin JSON requests');
  }

  const response = apiSuccess({ ok: true });
  response.headers.append('Set-Cookie', clearLdapSessionCookie());
  for (const cookie of clearGuestCookies()) response.headers.append('Set-Cookie', cookie);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
