import { CookieOptions, Response } from 'express';

/**
 * The session token lives in an httpOnly cookie, so a script injected into the
 * page cannot read it — which is the whole point. The API still accepts an
 * `Authorization: Bearer` header, because the Swagger UI, the end-to-end
 * suite and any future integration need one.
 */
export const SESSION_COOKIE = 'codex_token';

/** Rough ms for a JWT lifetime like `1d`, `12h`, `30m`, `3600`. */
function lifetimeMs(expires: string | undefined): number {
  const fallback = 24 * 60 * 60 * 1000;
  if (!expires) return fallback;
  const match = /^(\d+)\s*([smhd])?$/.exec(expires.trim());
  if (!match) return fallback;
  const value = Number(match[1]);
  const unit = match[2] ?? 's';
  const factor = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
  return value * (factor ?? 1000);
}

function options(expires?: string, remember = false): CookieOptions {
  const production = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    // the app and the API are served from one origin behind nginx, so `lax`
    // is enough and keeps the cookie on ordinary navigations
    sameSite: 'lax',
    // only sent over HTTPS in production; a dev install on http still works
    secure: production,
    path: '/',
    maxAge: lifetimeMs(expires) * (remember ? 30 : 1),
  };
}

export function setSessionCookie(
  res: Response,
  token: string,
  expires?: string,
  remember = false,
): void {
  res.cookie(SESSION_COOKIE, token, options(expires, remember));
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { ...options(), maxAge: undefined });
}
