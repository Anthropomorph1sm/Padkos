import { Router } from "express";
import { z } from "zod";
import { rateLimit } from "../auth";
import { config } from "../config";
import { mapLimit } from "../http";
import { encodedLegs, pointSchema } from "../schemas";
import { attractionsNear, ALL_CATEGORIES, planAttractionSearch } from "../services/attractions";
import { reverse, search } from "../services/geocode";
import { alternativesBetween } from "../services/osrm";
import { assertInSouthAfrica, insertionIndex, MAX_STOPS, plan } from "../services/planner";
import { roadIssues } from "../services/roadworks";
import { asyncHandler } from "./util";

/** Pause before automatically retrying failed stretches (overridable for tests). */
export const RETRY_PAUSE_MS = Number(process.env.ATTRACTION_RETRY_PAUSE_MS ?? 5000);

const attractionBody = z.object({
  legs: encodedLegs,
  radiusKm: z.number().min(0.5).max(50),
  categories: z.array(z.enum(ALL_CATEGORIES as [string, ...string[]])).max(ALL_CATEGORIES.length).default([]),
  limit: z.number().int().min(1).max(500).optional(),
});

export function planningRouter(): Router {
  const r = Router();

  r.get("/config", (_req, res) => {
    res.json({
      maxStops: MAX_STOPS,
      liveTraffic: !!config.tomtomKey,
      routingServer: new URL(config.osrmUrl).host,
    });
  });

  r.get(
    "/geocode/search",
    rateLimit("geocode", 120, 60_000),
    asyncHandler(async (req, res) => {
      const q = z.string().max(200).parse(req.query.q ?? "");
      const lat = Number(req.query.lat);
      const lng = Number(req.query.lng);
      const near = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined;
      res.json({ results: await search(q, near) });
    }),
  );

  r.get(
    "/geocode/reverse",
    rateLimit("reverse", 40, 60_000),
    asyncHandler(async (req, res) => {
      const { lat, lng } = pointSchema.parse({ lat: Number(req.query.lat), lng: Number(req.query.lng) });
      const result = await reverse(lat, lng);
      if (!result) {
        res.status(404).json({ error: "That spot is outside South Africa" });
        return;
      }
      res.json({ result });
    }),
  );

  const planBody = z.object({
    start: pointSchema,
    end: pointSchema.nullable().optional(),
    stops: z.array(pointSchema).max(MAX_STOPS),
    optimize: z.boolean().default(true),
    optimizeBy: z.enum(["duration", "distance"]).default("duration"),
    roundTrip: z.boolean().default(false),
  });

  r.post(
    "/plan",
    rateLimit("plan", 30, 60_000),
    asyncHandler(async (req, res) => {
      const body = planBody.parse(req.body);
      res.json({ plan: await plan(body) });
    }),
  );

  r.post(
    "/alternatives",
    rateLimit("alternatives", 60, 60_000),
    asyncHandler(async (req, res) => {
      const { from, to } = z.object({ from: pointSchema, to: pointSchema }).parse(req.body);
      assertInSouthAfrica([from, to]);
      res.json({ alternatives: await alternativesBetween([from.lat, from.lng], [to.lat, to.lng], to.name) });
    }),
  );

  r.post(
    "/insertion",
    rateLimit("insertion", 60, 60_000),
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          start: pointSchema,
          end: pointSchema,
          stops: z.array(pointSchema).max(MAX_STOPS - 1),
          point: pointSchema,
          legDurations: z.array(z.number()).max(MAX_STOPS + 1).optional(),
        })
        .parse(req.body);
      res.json({ index: await insertionIndex(body.start, body.end, body.stops, body.point, body.legDurations) });
    }),
  );

  r.post(
    "/attractions",
    rateLimit("attractions", 20, 60_000),
    asyncHandler(async (req, res) => {
      const body = attractionBody.parse(req.body);
      res.json(
        await attractionsNear({
          legs: body.legs,
          radiusKm: body.radiusKm,
          categories: body.categories as never,
          limit: body.limit,
        }),
      );
    }),
  );

  /**
   * Streaming attraction search. Responds with newline-delimited JSON events:
   *   {"type":"start","total":N,"sections":[...]}       sections that will be searched, in route order
   *   {"type":"section","index":i,"attractions":[...]}  results for one stretch of the route
   *   {"type":"section-error","index":i,"error":"..."}  that stretch failed after retries
   *   {"type":"retrying","sections":[...]}              failed stretches get one more try at the end
   *   {"type":"done","failed":[...]}
   * Pass "sections" to search only some stretches again (e.g. ones that failed).
   */
  r.post(
    "/attractions/stream",
    rateLimit("attractions", 30, 60_000),
    asyncHandler(async (req, res) => {
      const body = attractionBody
        .extend({ sections: z.array(z.number().int().min(0).max(500)).max(500).optional() })
        .parse(req.body);
      const search = planAttractionSearch({
        legs: body.legs,
        radiusKm: body.radiusKm,
        categories: body.categories as never,
        limit: body.limit,
      });
      const wanted = (body.sections ?? search.sections.map((_, i) => i)).filter((i) => i < search.sections.length);

      res.status(200);
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no"); // let nginx pass chunks straight through
      res.flushHeaders();

      let closed = false;
      res.on("close", () => {
        closed = true;
      });
      const send = (event: unknown) => {
        if (!closed) res.write(JSON.stringify(event) + "\n");
      };

      send({ type: "start", total: search.sections.length, sections: wanted });
      const failed: number[] = [];
      // three sections at a time (spread over the Overpass mirrors), in route order, so results
      // fill in from the start of the trip
      await mapLimit(wanted, 3, async (index) => {
        if (closed) return; // the browser cancelled — stop asking Overpass
        try {
          send({ type: "section", index, attractions: await search.run(index) });
        } catch (e) {
          failed.push(index);
          send({ type: "section-error", index, error: (e as Error).message });
        }
      });
      // one automatic second pass for stretches that failed: mirrors that were busy or rate
      // limiting a minute ago have usually recovered
      if (failed.length && !closed) {
        const again = failed.splice(0).sort((a, b) => a - b);
        send({ type: "retrying", sections: again });
        await new Promise((r) => setTimeout(r, RETRY_PAUSE_MS));
        await mapLimit(again, 2, async (index) => {
          if (closed) return;
          try {
            send({ type: "section", index, attractions: await search.run(index, 2) });
          } catch (e) {
            failed.push(index);
            send({ type: "section-error", index, error: (e as Error).message });
          }
        });
      }
      send({ type: "done", failed: failed.sort((a, b) => a - b) });
      res.end();
    }),
  );

  r.post(
    "/roadworks",
    rateLimit("roadworks", 20, 60_000),
    asyncHandler(async (req, res) => {
      const { legs } = z.object({ legs: encodedLegs }).parse(req.body);
      res.json(await roadIssues(legs));
    }),
  );

  return r;
}
