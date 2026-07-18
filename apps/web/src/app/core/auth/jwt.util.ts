/**
 * Decodes the payload segment of a JWT WITHOUT verifying its signature.
 * This is a client-side convenience for reading claims (role, tenantId) to
 * drive UI/guard decisions. The backend remains the source of truth for
 * signature verification.
 */
export function decodeJwtPayload<T>(token: string): T | null {
  if (!token) {
    return null;
  }

  const segments = token.split('.');
  if (segments.length < 2) {
    return null;
  }

  const [, payloadSegment] = segments;

  try {
    const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
    const json = atob(padded);
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
