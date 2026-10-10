import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { DB } from "./db";
import { config } from "./config";

export const SESSION_COOKIE = "padkos_session";

export interface AuthUser {
  id: string;
  username: string;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
  }
}

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [alg, n, saltB64, hashB64] = stored.split("$");
  if (alg !== "scrypt") return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n),
    r: SCRYPT.r,
    p: SCRYPT.p,
  });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export function createSession(db: DB, userId: string): { token: string; expires: Date } {
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + config.sessionDays * 86400_000);
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(sha256(token), userId, expires.toISOString());
  return { token, expires };
}

export function destroySession(db: DB, token: string) {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
}

export function setSessionCookie(res: Response, token: string, expires: Date) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.production,
    expires,
    path: "/",
  });
}

/** Attaches req.user when a valid session cookie is present. */
export function sessionMiddleware(db: DB) {
  const lookup = db.prepare(
    `SELECT u.id, u.username, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
  );
  return (req: Request, _res: Response, next: NextFunction) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (typeof token === "string" && token) {
      const row = lookup.get(sha256(token)) as { id: string; username: string; expires_at: string } | undefined;
      if (row && new Date(row.expires_at) > new Date()) req.user = { id: row.id, username: row.username };
    }
    next();
  };
}

export function requireUser(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: "Please sign in first" });
    return;
  }
  next();
}

/**
 * CSRF guard: state-changing requests must carry a custom header. Browsers cannot add custom
 * headers to cross-site form posts, and cross-origin fetches with them require a CORS preflight
 * which this server never approves.
 */
export function csrfGuard(req: Request, res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.get("x-padkos") !== "1") {
    res.status(403).json({ error: "Missing request header" });
    return;
  }
  next();
}

/** Tiny fixed-window rate limiter keyed by IP + bucket name. */
export function rateLimit(bucket: string, max: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${bucket}:${req.ip}`;
    const now = Date.now();
    let h = hits.get(key);
    if (!h || h.reset < now) {
      h = { n: 0, reset: now + windowMs };
      hits.set(key, h);
      if (hits.size > 10000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    }
    if (++h.n > max) {
      res.setHeader("Retry-After", Math.ceil((h.reset - now) / 1000));
      res.status(429).json({ error: "Too many requests — please slow down a little" });
      return;
    }
    next();
  };
}
