import { describe, expect, it } from 'vitest';

import { LdapConfigError, ldapEnabled, readLdapConfig } from '@/lib/server/identity/ldap/config';

const BASE_ENV = {
  NEXT_PUBLIC_LDAP_ENABLED: 'true',
  LDAP_URL: 'ldaps://ldap.example.com:636',
  LDAP_SEARCH_BASE: 'ou=people,dc=example,dc=com',
  LDAP_USER_FILTER: '(uid={username})',
  LDAP_SESSION_SECRET: 's'.repeat(48),
};

describe('readLdapConfig', () => {
  it('reads a complete configuration with safe defaults', () => {
    const config = readLdapConfig(BASE_ENV);
    expect(config.url).toBe('ldaps://ldap.example.com:636');
    expect(config.startTLS).toBe(false);
    expect(config.bindDn).toBeNull();
    expect(config.userIdAttribute).toBe('entryUUID');
    expect(config.timeoutMs).toBe(5000);
    expect(config.sessionTtlSeconds).toBe(604800);
  });

  it('accepts an LDAP URL with StartTLS and a service account', () => {
    const config = readLdapConfig({
      ...BASE_ENV,
      LDAP_URL: 'ldap://ldap.example.com:389',
      LDAP_STARTTLS: 'true',
      LDAP_BIND_DN: 'cn=openmaic,ou=services,dc=example,dc=com',
      LDAP_BIND_PASSWORD: 'secret',
    });
    expect(config.startTLS).toBe(true);
    expect(config.bindDn).toBe('cn=openmaic,ou=services,dc=example,dc=com');
  });

  it('names the missing field', () => {
    const { LDAP_URL: _unused, ...withoutUrl } = BASE_ENV;
    expect(() => readLdapConfig(withoutUrl)).toThrow(LdapConfigError);
    expect(() => readLdapConfig(withoutUrl)).toThrow(/LDAP_URL/);
  });

  it('requires a username placeholder in the filter', () => {
    expect(() => readLdapConfig({ ...BASE_ENV, LDAP_USER_FILTER: '(uid=alice)' })).toThrow(
      /LDAP_USER_FILTER.*\{username\}/,
    );
  });

  it('rejects a plain ldap:// URL without StartTLS', () => {
    expect(() => readLdapConfig({ ...BASE_ENV, LDAP_URL: 'ldap://ldap.example.com:389' })).toThrow(
      /LDAP_STARTTLS/,
    );
  });

  it('allows plain ldap:// only when the operator explicitly accepts it', () => {
    const config = readLdapConfig({
      ...BASE_ENV,
      LDAP_URL: 'ldap://ldap.example.com:389',
      LDAP_ALLOW_INSECURE: 'true',
    });
    expect(config.allowInsecure).toBe(true);
  });

  it('rejects StartTLS on ldaps://', () => {
    expect(() => readLdapConfig({ ...BASE_ENV, LDAP_STARTTLS: 'true' })).toThrow(/StartTLS/);
  });

  it('rejects half a service account', () => {
    expect(() => readLdapConfig({ ...BASE_ENV, LDAP_BIND_DN: 'cn=svc,dc=x' })).toThrow(
      /LDAP_BIND_PASSWORD/,
    );
  });

  it('requires a long session secret', () => {
    expect(() => readLdapConfig({ ...BASE_ENV, LDAP_SESSION_SECRET: 'short' })).toThrow(
      /LDAP_SESSION_SECRET/,
    );
  });
});

describe('ldapEnabled', () => {
  it('is on only for the exact public flag true/1', () => {
    expect(ldapEnabled({ NEXT_PUBLIC_LDAP_ENABLED: 'true' })).toBe(true);
    expect(ldapEnabled({ NEXT_PUBLIC_LDAP_ENABLED: '1' })).toBe(true);
    expect(ldapEnabled({ NEXT_PUBLIC_LDAP_ENABLED: 'false' })).toBe(false);
    expect(ldapEnabled({})).toBe(false);
  });
});
