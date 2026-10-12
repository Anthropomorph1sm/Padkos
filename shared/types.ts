// Domain model shared by client and server.

export type PlaceKind = "address" | "poi" | "city" | "attraction" | "custom";

export interface Place {
  id: string;
  name: string;
  address?: string;
  lat: number;
  lng: number;
  kind?: PlaceKind;
  /** Town / city used when the place is obscured on shared routes. */
  city?: string;
  /** Minutes spent at this stop (used for ETAs). */
  stayMinutes?: number;
  /** Obscure this stop to its city when the route is shared (start & end always are). */
  private?: boolean;
  /** Set on shared copies: this place was replaced by the centre of its town. */
  approximate?: boolean;
  /** Overnight choice: true = sleep here, false = never sleep here, undefined = automatic */
  overnight?: boolean;
  /** Nights spent here when sleeping here (default 1). On the destination: nights staying there (unset = none). */
  nights?: number;
  /** "HH:MM" to leave after sleeping here (default: the trip's departure time). */
  departTime?: string;
  notes?: string;
  /** Places to stay that the traveller saved for a night here. */
  stays?: SavedStay[];
}

export type StayKind =
  | "hotel"
  | "motel"
  | "guest_house"
  | "hostel"
  | "chalet"
  | "apartment"
  | "camp_site"
  | "caravan_site"
  | "alpine_hut"
  | "wilderness_hut";

/** A place to stay saved against an overnight stop. */
export interface SavedStay {
  id: string;
  name: string;
  /** Rand per night for the whole group. */
  price?: number;
  /** Listing or website link (http/https only). */
  url?: string;
  lat?: number;
  lng?: number;
  kind?: StayKind;
  /** The one the traveller picked: the budget then uses its price alone. */
  chosen?: boolean;
}

/** Accommodation found on OpenStreetMap near an overnight stop. */
export interface StayOption {
  id: string;
  name: string;
  lat: number;
  lng: number;
  kind: StayKind;
  /** straight-line distance from the stop, in metres */
  distance: number;
  stars?: number;
  website?: string;
  phone?: string;
  town?: string;
}

export type FuelEconomyUnit = "l100" | "kml";
export type FuelType = "95" | "93" | "diesel";
export type OptimizeBy = "duration" | "distance";

export interface FuelSettings {
  unit: FuelEconomyUnit;
  /** litres per 100 km when unit = l100, km per litre when unit = kml */
  value: number;
  fuelType: FuelType;
  /** Rand per litre */
  pricePerLitre: number;
  /** Optional tank size in litres, used to suggest refuelling points. */
  tankLitres?: number;
}

export interface TripSettings {
  optimize: boolean;
  optimizeBy: OptimizeBy;
  roundTrip: boolean;
  fuel: FuelSettings;
  /** ISO local datetime string, e.g. 2026-12-16T07:00 */
  departure?: string;
  maxDriveHoursPerDay: number;
  /** add overnight stops automatically when a day exceeds the driving limit (default true) */
  autoOvernight?: boolean;
  passengers: number;
  attractionRadiusKm: number;
}

export interface Trip {
  version: 1;
  title: string;
  description?: string;
  start: Place | null;
  end: Place | null;
  stops: Place[];
  settings: TripSettings;
  /** Per-plaza toll fee overrides (plaza id -> rand). */
  tollOverrides?: Record<string, number>;
}

export interface Step {
  instruction: string;
  distance: number;
  duration: number;
  name?: string;
  ref?: string;
  /** [lat, lng] */
  location: [number, number];
  type: string;
  modifier?: string;
}

export interface Leg {
  distance: number;
  duration: number;
  /** encoded polyline, precision 5, [lat,lng] */
  geometry: string;
  steps: Step[];
  summary: string;
  /** index of the alternative chosen for this leg (0 = default) */
  alternative?: number;
}

export interface RoutePlan {
  /** Visiting order of `stops` (indices into the request's stops array). */
  order: number[];
  legs: Leg[];
  distance: number;
  duration: number;
  optimized: boolean;
  /** Where the matrix used for optimisation came from. */
  matrixSource?: "osrm" | "straight-line";
  computedAt: string;
}

export interface RouteAlternative {
  distance: number;
  duration: number;
  geometry: string;
  steps: Step[];
  summary: string;
}

export type Visibility = "private" | "unlisted" | "public";

export interface SavedRouteSummary {
  id: string;
  title: string;
  description?: string;
  visibility: Visibility;
  startCity?: string;
  endCity?: string;
  distance?: number;
  duration?: number;
  stopCount: number;
  score: number;
  upvotes: number;
  downvotes: number;
  myVote?: number;
  owner: string;
  isOwner: boolean;
  shareToken?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SavedRoute extends SavedRouteSummary {
  trip: Trip;
  plan: RoutePlan | null;
  /** true when start/end (and private stops) were replaced by their cities */
  obscured: boolean;
}

export type AttractionCategory =
  | "attraction"
  | "nature"
  | "viewpoint"
  | "museum"
  | "heritage"
  | "wine"
  | "beach"
  | "camping"
  | "food"
  | "fuel";

export interface Attraction {
  id: string;
  name: string;
  lat: number;
  lng: number;
  category: AttractionCategory;
  kind: string;
  /** perpendicular distance to the route in metres */
  distanceFromRoute: number;
  /** estimated extra driving distance (there and back) in metres */
  detour: number;
  /** distance along the route of the closest point, in metres */
  along: number;
  popularity: number;
  website?: string;
  wikipedia?: string;
  description?: string;
  openingHours?: string;
}

export interface RoadIssue {
  id: string;
  source: "osm" | "tomtom";
  kind: "construction" | "closure" | "incident" | "roadworks";
  title: string;
  description?: string;
  lat: number;
  lng: number;
  distanceFromRoute: number;
  along?: number;
  delaySeconds?: number;
  startTime?: string;
  endTime?: string;
}

export interface TollHit {
  id: string;
  name: string;
  road: string;
  fee: number;
  /** fee came from a user override */
  overridden: boolean;
  lat: number;
  lng: number;
  /** distance along the route (metres) */
  along: number;
  /** leg index on which the plaza sits */
  leg: number;
}
