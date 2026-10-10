import path from "node:path";
import fs from "node:fs";
import express, { type NextFunction, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import { ZodError } from "zod";
import { config } from "./config";
import { csrfGuard, sessionMiddleware } from "./auth";
import type { DB } from "./db";
import { UpstreamError } from "./http";
import { accountRouter } from "./routes/account";
import { planningRouter } from "./routes/planning";
import { routesRouter, type RouteDeps } from "./routes/routes";
import { ValidationError } from "./services/planner";

// Leaflet positions tiles and markers with inline styles, so styles need 'unsafe-inline'.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

export interface AppOptions {
  db: DB;
  deps?: RouteDeps;
  /** directory with the built client to serve (production) */
  staticDir?: string;
}

export function createApp({ db, deps, staticDir }: AppOptions) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);

  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Content-Security-Policy", CSP);
    next();
  });

  const api = express.Router();
  // sign-in bodies are tiny; route geometry can be large
  api.use("/auth", express.json({ limit: "10kb" }));
  api.use(express.json({ limit: "20mb" }));
  api.use(cookieParser());
  api.use(csrfGuard);
  api.use(sessionMiddleware(db));
  api.get("/health", (_req, res) => {
    res.json({ ok: true });
  });
  api.use("/auth", accountRouter(db));
  api.use(planningRouter());
  api.use(routesRouter(db, deps));
  api.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });
  app.use("/api", api);

  if (staticDir && fs.existsSync(staticDir)) {
    app.use(express.static(staticDir, { index: false, maxAge: "1h" }));
    // client-side routing fallback
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(staticDir, "index.html"));
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      res.status(400).json({ error: first ? `${first.path.join(".") || "request"}: ${first.message}` : "Invalid request", issues: err.issues });
      return;
    }
    if (err instanceof ValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof UpstreamError) {
      res.status(err.status >= 400 && err.status < 600 ? err.status : 502).json({ error: err.message, upstream: err.upstream });
      return;
    }
    if ((err as { type?: string }).type === "entity.too.large") {
      res.status(413).json({ error: "Request too large" });
      return;
    }
    if ((err as { type?: string }).type === "entity.parse.failed") {
      res.status(400).json({ error: "Malformed JSON" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Something went wrong on our side" });
  });

  return app;
}
