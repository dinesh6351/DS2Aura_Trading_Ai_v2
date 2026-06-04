import jwt from 'jsonwebtoken';
import type { JwtClaims, Role } from '@platform/shared';
import { env } from '../config/env.js';

/**
 * Short-lived access tokens + long-lived refresh tokens.
 * Refresh tokens are opaque-ish JWTs whose hash is also stored in the Session
 * table so they can be revoked and rotated (rotation = new refresh token each
 * use, old session invalidated).
 */
export function signAccessToken(claims: { sub: string; role: Role; sid: string }): string {
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, { expiresIn: env.JWT_ACCESS_TTL });
}

export function signRefreshToken(claims: { sub: string; sid: string }): string {
  return jwt.sign(claims, env.JWT_REFRESH_SECRET, { expiresIn: env.JWT_REFRESH_TTL });
}

export function verifyAccessToken(token: string): JwtClaims {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtClaims;
}

export function verifyRefreshToken(token: string): { sub: string; sid: string } {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as { sub: string; sid: string };
}
