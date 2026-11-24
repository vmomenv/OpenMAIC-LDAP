/**
 * The API surface an anonymous classroom visitor may reach.
 *
 * Everything here is either a read the classroom needs or a capability route
 * that re-checks the course's published state and its `guest_*` flag. Every
 * other API path stays behind the LDAP gate, so a guest cookie can never reach
 * generation, uploads, model settings or exports.
 */

const EXACT_POST = new Set([
  '/api/generate/tts',
  '/api/generate/voice',
  '/api/quiz-grade',
  '/api/chat/pi',
  '/api/chat/pi/whiteboard-visibility',
]);

const PREFIXES = [
  '/api/persistence',
  '/api/stage-meta',
  '/api/classroom-media',
  '/api/pbl',
  '/api/proxy-media',
  '/api/transcription',
];

const READ_ONLY_EXACT = new Set(['/api/agents', '/api/skills']);

function hasBoundary(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Whether a guest cookie authenticates this request path (and method). */
export function isGuestAllowedApiPath(pathname: string, method: string | undefined): boolean {
  if (EXACT_POST.has(pathname)) return true;
  if (PREFIXES.some((prefix) => hasBoundary(pathname, prefix))) {
    // PBL has both reads and its own capability-checked actions; the rest is
    // the classroom's persistence/media surface.
    return true;
  }
  const upper = (method ?? 'GET').toUpperCase();
  if (upper !== 'GET' && upper !== 'HEAD') return false;
  return READ_ONLY_EXACT.has(pathname) || pathname.startsWith('/api/skills/');
}
