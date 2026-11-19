/**
 * LDAP directory authentication.
 *
 * The flow is the standard search-then-bind: connect, optionally upgrade with
 * StartTLS, bind the read-only service account, search for exactly one user,
 * then bind as that user with the password the login form supplied. A password
 * is never stored, logged, or sent anywhere but the directory.
 *
 * Failures are classified so the HTTP layer can answer 401 for a bad
 * username/password and 503 for an unavailable directory, without exposing
 * which one happened to the client.
 */
import { createHash } from 'node:crypto';

import { Client } from 'ldapts';

import type { LdapConfig } from './config';
import { escapeLdapFilterValue } from './filter';

/** The subset of an LDAP entry this module reads. */
export interface LdapSearchEntry {
  dn: string;
  [attribute: string]: unknown;
}

/** The client surface, narrowed for injection in tests. */
export interface LdapDirectoryClient {
  startTLS?(): Promise<void>;
  bind(dn: string, password: string): Promise<void>;
  search(
    base: string,
    options: {
      scope: 'sub';
      filter: string;
      attributes: string[];
      sizeLimit: number;
    },
  ): Promise<{ searchEntries: LdapSearchEntry[] }>;
  unbind(): Promise<void>;
}

export interface LdapAuthenticatorDeps {
  config: LdapConfig;
  /** Test seam; defaults to a real `ldapts` client. */
  createClient?: (config: LdapConfig) => LdapDirectoryClient;
}

export type LdapAuthenticationFailure =
  | 'invalid-credentials'
  | 'ambiguous-user'
  | 'directory-unavailable';

export class LdapAuthenticationError extends Error {
  constructor(
    readonly kind: LdapAuthenticationFailure,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'LdapAuthenticationError';
  }
}

export interface LdapIdentity {
  /** `ldap:<stable user id>`, the owner id every stored row is scoped by. */
  ownerId: string;
  /** The stable id itself (a UUID for OpenLDAP/AD, else the normalized DN). */
  userId: string;
  displayName?: string;
  dn: string;
}

function defaultCreateClient(config: LdapConfig): LdapDirectoryClient {
  const client = new Client({
    url: config.url,
    timeout: config.timeoutMs,
    connectTimeout: config.timeoutMs,
  });
  return client as unknown as LdapDirectoryClient;
}

/** Attribute lookup is case-insensitive, as LDAP attribute descriptions are. */
function attribute(entry: LdapSearchEntry, name: string): unknown {
  if (name in entry) return entry[name];
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(entry)) {
    if (key.toLowerCase() === wanted) return value;
  }
  return undefined;
}

function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Convert an Active Directory `objectGUID` (16 bytes, mixed endianness) to the
 * canonical `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` string.
 */
export function formatActiveDirectoryGuid(bytes: Uint8Array): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const first = view.getUint32(0, true).toString(16).padStart(8, '0');
  const second = view.getUint16(4, true).toString(16).padStart(4, '0');
  const third = view.getUint16(6, true).toString(16).padStart(4, '0');
  const tail = Array.from(bytes.subarray(8, 16))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `${first}-${second}-${third}-${tail.slice(0, 4)}-${tail.slice(4)}`;
}

function attributeToString(value: unknown, attributeName: string): string | undefined {
  const single = first(value);
  if (single === undefined || single === null) return undefined;
  if (typeof single === 'string') {
    const trimmed = single.trim();
    return trimmed === '' ? undefined : trimmed;
  }
  if (Buffer.isBuffer(single) || single instanceof Uint8Array) {
    const bytes = single as Uint8Array;
    if (attributeName.toLowerCase() === 'objectguid' && bytes.byteLength === 16) {
      return formatActiveDirectoryGuid(bytes);
    }
    return Buffer.from(bytes).toString('hex');
  }
  return undefined;
}

/**
 * Owner ids must be printable non-space ASCII (the identity seam refuses
 * anything else). Directory ids normally are; a DN with non-ASCII characters
 * is hashed instead, which stays stable for that exact DN.
 */
export function ldapOwnerId(userId: string): string {
  const raw = userId.trim();
  if (/^[\x21-\x7e]{1,200}$/.test(raw)) return `ldap:${raw}`;
  return `ldap:sha256-${createHash('sha256').update(raw).digest('hex')}`;
}

function invalidCredentials(): LdapAuthenticationError {
  return new LdapAuthenticationError('invalid-credentials', 'invalid username or password');
}

function isInvalidCredentialError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (code === 49) return true;
  return (error as { name?: unknown }).name === 'InvalidCredentialsError';
}

function validateInput(input: { username: string; password: string }): {
  username: string;
  password: string;
} {
  const raw = input.username.trim();
  // Windows domains are often typed as DOMAIN\user; the directory search
  // matches the account name itself.
  const username = raw.includes('\\') ? raw.slice(raw.lastIndexOf('\\') + 1).trim() : raw;
  if (
    username.length === 0 ||
    username.length > 256 ||
    /[\u0000-\u001f\u007f]/.test(username) ||
    input.password.length === 0 ||
    input.password.length > 1024
  ) {
    throw invalidCredentials();
  }
  return { username, password: input.password };
}

/**
 * Verify `username`/`password` against the directory and return the owner
 * identity it proves. Throws {@link LdapAuthenticationError}.
 */
export async function authenticateLdapUser(
  input: { username: string; password: string },
  deps: LdapAuthenticatorDeps,
): Promise<LdapIdentity> {
  // A blank password would be an unauthenticated (anonymous) bind in LDAP, so
  // refuse it before touching the network.
  const { username, password } = validateInput(input);
  const { config } = deps;

  let client: LdapDirectoryClient;
  try {
    client = (deps.createClient ?? defaultCreateClient)(config);
  } catch (error) {
    throw new LdapAuthenticationError('directory-unavailable', 'the directory is unavailable', {
      cause: error,
    });
  }

  try {
    if (config.startTLS) {
      if (!client.startTLS) {
        throw new LdapAuthenticationError(
          'directory-unavailable',
          'the directory client cannot start TLS',
        );
      }
      try {
        await client.startTLS();
      } catch (error) {
        throw new LdapAuthenticationError('directory-unavailable', 'StartTLS failed', {
          cause: error,
        });
      }
    }

    if (config.bindDn !== null) {
      try {
        await client.bind(config.bindDn, config.bindPassword ?? '');
      } catch (error) {
        throw new LdapAuthenticationError(
          'directory-unavailable',
          'the service account could not bind',
          { cause: error },
        );
      }
    }

    const filter = config.userFilter.replaceAll('{username}', escapeLdapFilterValue(username));
    let entries: LdapSearchEntry[];
    try {
      const result = await client.search(config.searchBase, {
        scope: 'sub',
        filter,
        attributes: [config.userIdAttribute, config.displayNameAttribute].filter(
          (name) => name.length > 0,
        ),
        sizeLimit: 2,
      });
      entries = result.searchEntries;
    } catch (error) {
      throw new LdapAuthenticationError('directory-unavailable', 'the user search failed', {
        cause: error,
      });
    }

    if (entries.length === 0) throw invalidCredentials();
    if (entries.length > 1) {
      throw new LdapAuthenticationError(
        'ambiguous-user',
        'the username matched more than one directory entry',
      );
    }

    const entry = entries[0]!;
    const stableId = attributeToString(
      attribute(entry, config.userIdAttribute),
      config.userIdAttribute,
    );
    // A directory without entryUUID/objectGUID still gets one stable owner per
    // entry: the normalized DN. Moving the entry later is a new owner.
    const userId = stableId ?? entry.dn.trim().toLowerCase();
    const displayName =
      config.displayNameAttribute.length > 0
        ? attributeToString(
            attribute(entry, config.displayNameAttribute),
            config.displayNameAttribute,
          )
        : undefined;

    try {
      await client.bind(entry.dn, password);
    } catch (error) {
      if (isInvalidCredentialError(error)) throw invalidCredentials();
      throw new LdapAuthenticationError('directory-unavailable', 'the user bind failed', {
        cause: error,
      });
    }

    return {
      ownerId: ldapOwnerId(userId),
      userId,
      ...(displayName ? { displayName } : {}),
      dn: entry.dn,
    };
  } finally {
    try {
      await client.unbind();
    } catch {
      // A failed unbind changes nothing the caller needs to know.
    }
  }
}
