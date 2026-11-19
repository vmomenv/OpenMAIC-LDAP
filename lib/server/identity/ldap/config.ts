/**
 * LDAP deployment configuration, read from the environment.
 *
 * Everything here is deployment-wide and server-only except
 * `NEXT_PUBLIC_LDAP_ENABLED`, which is also read by the middleware to gate
 * pages. Keeping the flag public is deliberate: it reveals only whether the
 * deployment has accounts, and it lets the Edge runtime decide without loading
 * the Node-only session verifier.
 */
import {
  LDAP_SESSION_DEFAULT_TTL_SECONDS,
  LDAP_SESSION_MAX_TTL_SECONDS,
  LDAP_SESSION_MIN_TTL_SECONDS,
} from './session-shared';

export type LdapEnvironment = Record<string, string | undefined>;

export interface LdapConfig {
  /** `ldap://` or `ldaps://` URL of the directory. */
  url: string;
  /** Upgrade a plain `ldap://` connection with StartTLS before authenticating. */
  startTLS: boolean;
  /**
   * Whether a plain `ldap://` connection without StartTLS is accepted. Only
   * for a directory that cannot offer either, on a network the operator
   * already trusts: the user's password crosses that hop in clear text.
   */
  allowInsecure: boolean;
  /** Read-only account used to find the user entry; null for anonymous search. */
  bindDn: string | null;
  bindPassword: string | null;
  /** DN under which user entries live. */
  searchBase: string;
  /** RFC 4515 filter containing `{username}` once. */
  userFilter: string;
  /** Attribute holding the stable per-user id. */
  userIdAttribute: string;
  /** Attribute holding a display name; empty disables it. */
  displayNameAttribute: string;
  timeoutMs: number;
  sessionSecret: string;
  sessionTtlSeconds: number;
}

export class LdapConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LdapConfigError';
  }
}

/** The public switch: exactly `true` or `1` enables LDAP accounts. */
export function ldapEnabled(env: LdapEnvironment = process.env): boolean {
  const raw = env.NEXT_PUBLIC_LDAP_ENABLED?.trim().toLowerCase();
  return raw === 'true' || raw === '1';
}

/** Whether a directory URL is present, regardless of the switch. */
export function ldapConfigured(env: LdapEnvironment = process.env): boolean {
  return (env.LDAP_URL?.trim() ?? '') !== '';
}

function required(env: LdapEnvironment, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new LdapConfigError(
      `${name} is required when NEXT_PUBLIC_LDAP_ENABLED=true; set it in .env.local (see .env.local.example).`,
    );
  }
  return value;
}

function optional(env: LdapEnvironment, name: string): string | null {
  const value = env[name]?.trim();
  return value ? value : null;
}

function flag(env: LdapEnvironment, name: string, fallback: boolean): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  throw new LdapConfigError(
    `${name} must be "true", "1", "false" or "0", got ${JSON.stringify(env[name])}.`,
  );
}

function integer(
  env: LdapEnvironment,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new LdapConfigError(
      `${name} must be a whole number of seconds, got ${JSON.stringify(raw)}.`,
    );
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new LdapConfigError(`${name} must be between ${min} and ${max}, got ${value}.`);
  }
  return value;
}

/**
 * Read and validate the LDAP settings. Throws {@link LdapConfigError} naming
 * the setting to fix; the boot turns that into a one-line refusal.
 */
export function readLdapConfig(env: LdapEnvironment = process.env): LdapConfig {
  const url = required(env, 'LDAP_URL');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new LdapConfigError(`LDAP_URL is not a valid URL: ${JSON.stringify(url)}.`);
  }
  if (parsed.protocol !== 'ldap:' && parsed.protocol !== 'ldaps:') {
    throw new LdapConfigError(
      `LDAP_URL must start with ldap:// or ldaps://, got ${JSON.stringify(url)}.`,
    );
  }
  if (!parsed.hostname) {
    throw new LdapConfigError(`LDAP_URL has no host: ${JSON.stringify(url)}.`);
  }

  const startTLS = flag(env, 'LDAP_STARTTLS', false);
  const allowInsecure = flag(env, 'LDAP_ALLOW_INSECURE', false);
  if (parsed.protocol === 'ldap:' && !startTLS && !allowInsecure) {
    throw new LdapConfigError(
      'LDAP_URL uses plain ldap:// without transport security. Set LDAP_STARTTLS=true, use ldaps://, or accept the risk explicitly with LDAP_ALLOW_INSECURE=true.',
    );
  }
  if (parsed.protocol === 'ldaps:' && startTLS) {
    throw new LdapConfigError(
      'StartTLS (LDAP_STARTTLS) must not be set with an ldaps:// LDAP_URL; the connection is already encrypted.',
    );
  }

  const searchBase = required(env, 'LDAP_SEARCH_BASE');
  const userFilter = required(env, 'LDAP_USER_FILTER');
  if (!userFilter.includes('{username}')) {
    throw new LdapConfigError(
      'LDAP_USER_FILTER must contain the {username} placeholder, for example (uid={username}).',
    );
  }

  const bindDn = optional(env, 'LDAP_BIND_DN');
  const bindPassword = optional(env, 'LDAP_BIND_PASSWORD');
  if ((bindDn === null) !== (bindPassword === null)) {
    throw new LdapConfigError(
      'LDAP_BIND_DN and LDAP_BIND_PASSWORD must be set together, or both left empty for anonymous search.',
    );
  }

  const sessionSecret = required(env, 'LDAP_SESSION_SECRET');
  if (sessionSecret.length < 16) {
    throw new LdapConfigError(
      'LDAP_SESSION_SECRET must be at least 16 characters; generate one with `openssl rand -base64 32`.',
    );
  }

  return {
    url,
    startTLS,
    allowInsecure,
    bindDn,
    bindPassword,
    searchBase,
    userFilter,
    userIdAttribute: optional(env, 'LDAP_USER_ID_ATTRIBUTE') ?? 'entryUUID',
    displayNameAttribute: optional(env, 'LDAP_DISPLAY_NAME_ATTRIBUTE') ?? 'displayName',
    timeoutMs: integer(env, 'LDAP_TIMEOUT_MS', 5000, 1000, 60_000),
    sessionSecret,
    sessionTtlSeconds: integer(
      env,
      'LDAP_SESSION_TTL_SECONDS',
      LDAP_SESSION_DEFAULT_TTL_SECONDS,
      LDAP_SESSION_MIN_TTL_SECONDS,
      LDAP_SESSION_MAX_TTL_SECONDS,
    ),
  };
}

/** Boot check: only validates when the switch is on. */
export function validateLdapConfiguration(env: LdapEnvironment = process.env): void {
  if (!ldapEnabled(env)) return;
  readLdapConfig(env);
}
