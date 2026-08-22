import { describe, it, expect } from 'vitest';
import { decodeJwtPayload } from './jwt.util';

function base64UrlEncode(json: string): string {
  const base64 = btoa(json);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function buildFakeJwt(payload: unknown): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify(payload));
  return `${header}.${body}.fake-signature`;
}

describe('decodeJwtPayload', () => {
  it('decodes a base64url-encoded JWT payload segment', () => {
    const token = buildFakeJwt({ sub: 'user-1', role: 'teacher', tenantId: 'tenant-1' });

    const payload = decodeJwtPayload<{ sub: string; role: string; tenantId: string | null }>(token);

    expect(payload).toEqual({ sub: 'user-1', role: 'teacher', tenantId: 'tenant-1' });
  });

  it('handles a null tenantId (platform-level roles)', () => {
    const token = buildFakeJwt({ sub: 'user-2', role: 'platform_admin', tenantId: null });

    const payload = decodeJwtPayload<{ sub: string; role: string; tenantId: string | null }>(token);

    expect(payload?.tenantId).toBeNull();
  });

  it('returns null for a malformed token', () => {
    expect(decodeJwtPayload('not-a-jwt')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(decodeJwtPayload('')).toBeNull();
  });
});
