import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import {
  createSession,
  destroySession,
  hashPassword,
  rateLimit,
  SESSION_COOKIE,
  setSessionCookie,
  verifyPassword,
} from "../auth";
import type { DB } from "../db";

const credentials = z.object({
  username: z
    .string()
    .trim()
    .min(3, "Username must be at least 3 characters")
    .max(32)
    .regex(/^[a-zA-Z0-9_.-]+$/, "Use letters, numbers, dots, dashes or underscores"),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

// Checked when the username doesn't exist, so a failed login takes as long either way.
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString("hex"));

export function accountRouter(db: DB): Router {
  const r = Router();
  const limiter = rateLimit("auth", 20, 10 * 60_000);

  r.get("/me", (req, res) => {
    res.json({ user: req.user ?? null });
  });

  r.post("/register", limiter, (req, res) => {
    const { username, password } = credentials.parse(req.body);
    const exists = db.prepare("SELECT 1 FROM users WHERE username = ?").get(username);
    if (exists) {
      res.status(409).json({ error: "That username is taken" });
      return;
    }
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)").run(id, username, hashPassword(password));
    const { token, expires } = createSession(db, id);
    setSessionCookie(res, token, expires);
    res.status(201).json({ user: { id, username } });
  });

  r.post("/login", limiter, (req, res) => {
    const { username, password } = z.object({ username: z.string().trim().max(32), password: z.string().max(200) }).parse(req.body);
    const row = db.prepare("SELECT id, username, password_hash FROM users WHERE username = ?").get(username) as
      | { id: string; username: string; password_hash: string }
      | undefined;
    const ok = verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
    if (!row || !ok) {
      res.status(401).json({ error: "Wrong username or password" });
      return;
    }
    const { token, expires } = createSession(db, row.id);
    setSessionCookie(res, token, expires);
    res.json({ user: { id: row.id, username: row.username } });
  });

  r.post("/logout", (req, res) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (typeof token === "string") destroySession(db, token);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.json({ ok: true });
  });

  return r;
}
