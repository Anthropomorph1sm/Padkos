// Saved routes, sharing, voting and the public community feed.
import crypto from "node:crypto";
import { Router, type Request } from "express";
import { z } from "zod";
import type { RoutePlan, SavedRoute, SavedRouteSummary, Trip, Visibility } from "../../shared/types";
import { rateLimit, requireUser } from "../auth";
import { tx, type DB } from "../db";
import { planSchema, tripSchema, visibilitySchema } from "../schemas";
import type { cityFor } from "../services/geocode";
import { obscureTrip } from "../services/privacy";
import { asyncHandler } from "./util";

interface RouteRow {
  id: string;
  owner_id: string;
  owner_name: string;
  title: string;
  description: string | null;
  visibility: Visibility;
  share_token: string | null;
  trip_json: string;
  plan_json: string | null;
  public_trip_json: string | null;
  public_plan_json: string | null;
  start_city: string | null;
  end_city: string | null;
  provinces: string | null;
  distance: number | null;
  duration: number | null;
  stop_count: number;
  upvotes: number;
  downvotes: number;
  created_at: string;
  updated_at: string;
  my_vote?: number | null;
}

const SELECT = `SELECT r.*, u.username AS owner_name FROM routes r JOIN users u ON u.id = r.owner_id`;

export interface RouteDeps {
  cityLookup?: typeof cityFor;
}

export function routesRouter(db: DB, deps: RouteDeps = {}): Router {
  const r = Router();
  const writeLimit = rateLimit("route-write", 60, 60_000);

  const voteOf = (routeId: string, userId?: string) =>
    userId
      ? ((db.prepare("SELECT value FROM votes WHERE route_id = ? AND user_id = ?").get(routeId, userId) as { value: number } | undefined)
          ?.value ?? 0)
      : 0;

  function summary(row: RouteRow, req: Request): SavedRouteSummary {
    const isOwner = req.user?.id === row.owner_id;
    return {
      id: row.id,
      title: row.title,
      description: row.description ?? undefined,
      visibility: row.visibility,
      startCity: row.start_city ?? undefined,
      endCity: row.end_city ?? undefined,
      distance: row.distance ?? undefined,
      duration: row.duration ?? undefined,
      stopCount: row.stop_count,
      score: row.upvotes - row.downvotes,
      upvotes: row.upvotes,
      downvotes: row.downvotes,
      myVote: row.my_vote ?? voteOf(row.id, req.user?.id),
      owner: row.owner_name,
      isOwner,
      shareToken: isOwner && row.visibility !== "private" ? row.share_token ?? undefined : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /** Full view: owners see everything, everyone else sees the obscured copy. */
  function full(row: RouteRow, req: Request): SavedRoute {
    const isOwner = req.user?.id === row.owner_id;
    const trip = JSON.parse(isOwner ? row.trip_json : row.public_trip_json ?? "null") as Trip;
    const planJson = isOwner ? row.plan_json : row.public_plan_json;
    return {
      ...summary(row, req),
      trip,
      plan: planJson ? (JSON.parse(planJson) as RoutePlan) : null,
      obscured: !isOwner,
    };
  }

  /** Recompute denormalised and obscured columns for a route. */
  async function derive(trip: Trip, plan: RoutePlan | null, visibility: Visibility) {
    const base = {
      distance: plan?.distance ?? null,
      duration: plan?.duration ?? null,
      stop_count: trip.stops.length,
    };
    if (visibility === "private") {
      return {
        ...base,
        start_city: trip.start?.city ?? null,
        end_city: (trip.settings.roundTrip ? trip.start?.city : trip.end?.city) ?? null,
        provinces: null,
        public_trip_json: null,
        public_plan_json: null,
      };
    }
    const o = await obscureTrip(trip, plan, deps.cityLookup);
    return {
      ...base,
      start_city: o.startCity ?? null,
      end_city: o.endCity ?? null,
      provinces: o.provinces.join("|") || null,
      public_trip_json: JSON.stringify(o.trip),
      public_plan_json: o.plan ? JSON.stringify(o.plan) : null,
    };
  }

  const getRow = (id: string) =>
    db.prepare(`${SELECT} WHERE r.id = ?`).get(id) as RouteRow | undefined;

  // ---------------------------------------------------------------- my routes

  r.get("/routes", requireUser, (req, res) => {
    const rows = db.prepare(`${SELECT} WHERE r.owner_id = ? ORDER BY r.updated_at DESC`).all(req.user!.id) as unknown as RouteRow[];
    res.json({ routes: rows.map((row) => summary(row, req)) });
  });

  const createBody = z.object({
    trip: tripSchema,
    plan: planSchema.nullable().optional(),
    visibility: visibilitySchema.default("private"),
  });

  r.post(
    "/routes",
    requireUser,
    writeLimit,
    asyncHandler(async (req, res) => {
      const body = createBody.parse(req.body);
      const trip = body.trip as Trip;
      const plan = (body.plan ?? null) as RoutePlan | null;
      const d = await derive(trip, plan, body.visibility);
      const id = crypto.randomBytes(8).toString("base64url");
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO routes (id, owner_id, title, description, visibility, share_token, trip_json, plan_json,
           public_trip_json, public_plan_json, start_city, end_city, provinces, distance, duration, stop_count,
           created_at, updated_at, published_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        req.user!.id,
        trip.title,
        trip.description ?? null,
        body.visibility,
        crypto.randomBytes(12).toString("base64url"),
        JSON.stringify(trip),
        plan ? JSON.stringify(plan) : null,
        d.public_trip_json,
        d.public_plan_json,
        d.start_city,
        d.end_city,
        d.provinces,
        d.distance,
        d.duration,
        d.stop_count,
        now,
        now,
        body.visibility === "public" ? now : null,
      );
      res.status(201).json({ route: full(getRow(id)!, req) });
    }),
  );

  const updateBody = z.object({
    trip: tripSchema.optional(),
    plan: planSchema.nullable().optional(),
    visibility: visibilitySchema.optional(),
  });

  r.put(
    "/routes/:id",
    requireUser,
    writeLimit,
    asyncHandler(async (req, res) => {
      const row = getRow(String(req.params.id));
      if (!row || row.owner_id !== req.user!.id) {
        res.status(404).json({ error: "Route not found" });
        return;
      }
      const body = updateBody.parse(req.body);
      const trip = (body.trip ?? JSON.parse(row.trip_json)) as Trip;
      const plan = (body.plan !== undefined ? body.plan : row.plan_json ? JSON.parse(row.plan_json) : null) as RoutePlan | null;
      const visibility = body.visibility ?? row.visibility;
      const d = await derive(trip, plan, visibility);
      const now = new Date().toISOString();
      db.prepare(
        `UPDATE routes SET title = ?, description = ?, visibility = ?, trip_json = ?, plan_json = ?, public_trip_json = ?,
           public_plan_json = ?, start_city = ?, end_city = ?, provinces = ?, distance = ?, duration = ?, stop_count = ?,
           updated_at = ?, published_at = CASE WHEN ? = 'public' THEN COALESCE(published_at, ?) ELSE published_at END
         WHERE id = ?`,
      ).run(
        trip.title,
        trip.description ?? null,
        visibility,
        JSON.stringify(trip),
        plan ? JSON.stringify(plan) : null,
        d.public_trip_json,
        d.public_plan_json,
        d.start_city,
        d.end_city,
        d.provinces,
        d.distance,
        d.duration,
        d.stop_count,
        now,
        visibility,
        now,
        row.id,
      );
      res.json({ route: full(getRow(row.id)!, req) });
    }),
  );

  r.delete("/routes/:id", requireUser, (req, res) => {
    const row = getRow(String(req.params.id));
    if (!row || row.owner_id !== req.user!.id) {
      res.status(404).json({ error: "Route not found" });
      return;
    }
    db.prepare("DELETE FROM routes WHERE id = ?").run(row.id);
    res.json({ ok: true });
  });

  /** Owners can rotate the share link, invalidating the old one. */
  r.post("/routes/:id/share-token", requireUser, (req, res) => {
    const row = getRow(String(req.params.id));
    if (!row || row.owner_id !== req.user!.id) {
      res.status(404).json({ error: "Route not found" });
      return;
    }
    const token = crypto.randomBytes(12).toString("base64url");
    db.prepare("UPDATE routes SET share_token = ? WHERE id = ?").run(token, row.id);
    res.json({ shareToken: token });
  });

  // ---------------------------------------------------------------- viewing

  /** A route the current request may see: owner, public, or unlisted with the right token. */
  function accessible(id: string, req: Request, token?: string): RouteRow | undefined {
    const row = getRow(id);
    if (!row) return undefined;
    if (req.user?.id === row.owner_id) return row;
    if (row.visibility === "public") return row;
    if (row.visibility === "unlisted" && token && row.share_token && safeEqual(token, row.share_token)) return row;
    return undefined;
  }

  r.get("/routes/:id", (req, res) => {
    const row = accessible(String(req.params.id), req, typeof req.query.token === "string" ? req.query.token : undefined);
    if (!row) {
      res.status(404).json({ error: "Route not found" });
      return;
    }
    res.json({ route: full(row, req) });
  });

  r.get("/shared/:token", (req, res) => {
    const row = db.prepare(`${SELECT} WHERE r.share_token = ? AND r.visibility != 'private'`).get(String(req.params.token)) as
      | RouteRow
      | undefined;
    if (!row) {
      res.status(404).json({ error: "This share link is no longer valid" });
      return;
    }
    res.json({ route: full(row, req) });
  });

  // ---------------------------------------------------------------- votes & copies

  r.post("/routes/:id/vote", requireUser, writeLimit, (req, res) => {
    const { value, token } = z.object({ value: z.union([z.literal(1), z.literal(-1), z.literal(0)]), token: z.string().optional() }).parse(req.body);
    const row = accessible(String(req.params.id), req, token);
    if (!row || row.visibility === "private") {
      res.status(404).json({ error: "Route not found" });
      return;
    }
    if (row.owner_id === req.user!.id) {
      res.status(400).json({ error: "You can't vote on your own route" });
      return;
    }
    tx(db, () => {
      if (value === 0) db.prepare("DELETE FROM votes WHERE route_id = ? AND user_id = ?").run(row.id, req.user!.id);
      else
        db.prepare(
          `INSERT INTO votes (route_id, user_id, value) VALUES (?, ?, ?)
           ON CONFLICT(route_id, user_id) DO UPDATE SET value = excluded.value, created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
        ).run(row.id, req.user!.id, value);
      db.prepare(
        `UPDATE routes SET
           upvotes = (SELECT COUNT(*) FROM votes WHERE route_id = ? AND value = 1),
           downvotes = (SELECT COUNT(*) FROM votes WHERE route_id = ? AND value = -1)
         WHERE id = ?`,
      ).run(row.id, row.id, row.id);
    });
    const updated = getRow(row.id)!;
    res.json({ score: updated.upvotes - updated.downvotes, upvotes: updated.upvotes, downvotes: updated.downvotes, myVote: value });
  });

  r.post(
    "/routes/:id/copy",
    requireUser,
    writeLimit,
    asyncHandler(async (req, res) => {
      const { token } = z.object({ token: z.string().optional() }).parse(req.body ?? {});
      const row = accessible(String(req.params.id), req, token);
      if (!row) {
        res.status(404).json({ error: "Route not found" });
        return;
      }
      const view = full(row, req);
      const trip: Trip = { ...view.trip, title: `${view.trip.title} (copy)`.slice(0, 120) };
      // An obscured plan no longer matches the city-level start/end, so copies of other people's
      // routes start without one and are re-planned when opened.
      const plan = view.obscured ? null : view.plan;
      const d = await derive(trip, plan, "private");
      const id = crypto.randomBytes(8).toString("base64url");
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO routes (id, owner_id, title, description, visibility, share_token, trip_json, plan_json, start_city, end_city,
           distance, duration, stop_count, forked_from, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'private', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        req.user!.id,
        trip.title,
        trip.description ?? null,
        crypto.randomBytes(12).toString("base64url"),
        JSON.stringify(trip),
        plan ? JSON.stringify(plan) : null,
        d.start_city,
        d.end_city,
        d.distance,
        d.duration,
        d.stop_count,
        row.id,
        now,
        now,
      );
      res.status(201).json({ route: full(getRow(id)!, req) });
    }),
  );

  // ---------------------------------------------------------------- community

  r.get("/community", (req, res) => {
    const q = z
      .object({
        sort: z.enum(["popular", "top", "new"]).default("popular"),
        q: z.string().max(100).optional(),
        province: z.string().max(60).optional(),
        page: z.coerce.number().int().min(1).max(1000).default(1),
        pageSize: z.coerce.number().int().min(1).max(50).default(20),
      })
      .parse(req.query);
    const where = ["r.visibility = 'public'"];
    const params: (string | number)[] = [];
    if (q.q) {
      where.push("(r.title LIKE ? OR r.description LIKE ? OR r.start_city LIKE ? OR r.end_city LIKE ?)");
      const like = `%${q.q.replace(/[%_]/g, "")}%`;
      params.push(like, like, like, like);
    }
    if (q.province) {
      where.push("r.provinces LIKE ?");
      params.push(`%${q.province.replace(/[%_]/g, "")}%`);
    }
    const order =
      q.sort === "new"
        ? "r.published_at DESC"
        : q.sort === "top"
          ? "(r.upvotes - r.downvotes) DESC, r.upvotes DESC, r.published_at DESC"
          : // "hot": score decays with age, like a link aggregator
            "((r.upvotes - r.downvotes) + 1) / pow((julianday('now') - julianday(r.published_at)) * 24 + 2, 1.5) DESC, r.published_at DESC";
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM routes r WHERE ${where.join(" AND ")}`).get(...params) as { n: number }).n;
    const rows = db
      .prepare(
        `SELECT r.*, u.username AS owner_name, v.value AS my_vote FROM routes r
         JOIN users u ON u.id = r.owner_id
         LEFT JOIN votes v ON v.route_id = r.id AND v.user_id = ?
         WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ? OFFSET ?`,
      )
      .all(req.user?.id ?? "", ...params, q.pageSize, (q.page - 1) * q.pageSize) as unknown as RouteRow[];
    res.json({
      routes: rows.map((row) => summary({ ...row, my_vote: row.my_vote ?? 0 }, req)),
      total,
      page: q.page,
      pageSize: q.pageSize,
    });
  });

  return r;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
