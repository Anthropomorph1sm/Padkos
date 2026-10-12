import { z } from "zod";

const finite = z.number().refine(Number.isFinite, "must be a finite number");

export const pointSchema = z.object({
  lat: finite.min(-90).max(90),
  lng: finite.min(-180).max(180),
  name: z.string().max(200).optional(),
});

const STAY_KINDS = ["hotel", "motel", "guest_house", "hostel", "chalet", "apartment", "camp_site", "caravan_site", "alpine_hut", "wilderness_hut"] as const;

export const savedStaySchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(200),
  price: finite.min(0).max(1_000_000).optional(),
  url: z.string().max(2000).regex(/^https?:\/\//i, "must be an http(s) link").optional(),
  lat: finite.min(-90).max(90).optional(),
  lng: finite.min(-180).max(180).optional(),
  kind: z.enum(STAY_KINDS).optional(),
  chosen: z.boolean().optional(),
});

export const placeSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(200),
  address: z.string().max(400).optional(),
  lat: finite.min(-90).max(90),
  lng: finite.min(-180).max(180),
  kind: z.enum(["address", "poi", "city", "attraction", "custom"]).optional(),
  city: z.string().max(160).optional(),
  stayMinutes: finite.min(0).max(60 * 24 * 14).optional(),
  private: z.boolean().optional(),
  approximate: z.boolean().optional(),
  overnight: z.boolean().optional(),
  nights: z.number().int().min(1).max(30).optional(),
  departTime: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, "use HH:MM").optional(),
  notes: z.string().max(2000).optional(),
  stays: z.array(savedStaySchema).max(20).optional(),
});

export const settingsSchema = z.object({
  optimize: z.boolean(),
  optimizeBy: z.enum(["duration", "distance"]),
  roundTrip: z.boolean(),
  fuel: z.object({
    unit: z.enum(["l100", "kml"]),
    value: finite.min(0).max(200),
    fuelType: z.enum(["95", "93", "diesel"]),
    pricePerLitre: finite.min(0).max(200),
    tankLitres: finite.min(0).max(2000).optional(),
  }),
  departure: z.string().max(40).optional(),
  maxDriveHoursPerDay: finite.min(1).max(24),
  autoOvernight: z.boolean().optional(),
  passengers: z.number().int().min(1).max(100),
  attractionRadiusKm: finite.min(0.5).max(100),
});

export const tripSchema = z.object({
  version: z.literal(1),
  title: z.string().trim().min(1).max(120),
  description: z.string().max(4000).optional(),
  start: placeSchema.nullable(),
  end: placeSchema.nullable(),
  stops: z.array(placeSchema).max(100),
  settings: settingsSchema,
  tollOverrides: z.record(z.string().max(64), finite.min(0).max(100000)).optional(),
});

const stepSchema = z.object({
  instruction: z.string().max(500),
  distance: finite,
  duration: finite,
  name: z.string().max(300).optional(),
  ref: z.string().max(100).optional(),
  location: z.tuple([finite, finite]),
  type: z.string().max(40),
  modifier: z.string().max(40).optional(),
});

export const legSchema = z.object({
  distance: finite,
  duration: finite,
  geometry: z.string().max(3_000_000),
  steps: z.array(stepSchema).max(10000),
  summary: z.string().max(500),
  alternative: z.number().int().min(0).max(5).optional(),
});

export const planSchema = z.object({
  order: z.array(z.number().int()).max(100),
  legs: z.array(legSchema).max(101),
  distance: finite,
  duration: finite,
  optimized: z.boolean(),
  matrixSource: z.enum(["osrm", "straight-line"]).optional(),
  computedAt: z.string().max(40),
});

export const visibilitySchema = z.enum(["private", "unlisted", "public"]);

export const encodedLegs = z.array(z.string().max(3_000_000)).min(1).max(101);
