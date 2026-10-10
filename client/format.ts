export function km(metres: number | undefined, decimals?: number): string {
  if (metres == null || !Number.isFinite(metres)) return "–";
  const k = metres / 1000;
  const d = decimals ?? (k < 10 ? 1 : 0);
  return `${k.toLocaleString("en-ZA", { minimumFractionDigits: d, maximumFractionDigits: d }).replace(/ /g, " ")} km`;
}

export function distanceShort(metres: number): string {
  if (metres < 1000) return `${Math.round(metres / 10) * 10} m`;
  return km(metres);
}

export function duration(seconds: number | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "–";
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h >= 24) return `${h} h`; // driving time: "309 h" reads better than calendar days
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function clock(d: Date): string {
  return d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function dayLabel(d: Date): string {
  return d.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" });
}

export function relativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400_000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
}

/** Trigger a browser download for generated text. */
export function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "trip";
}

export const storage = {
  get<T>(key: string): T | null {
    try {
      const v = localStorage.getItem(key);
      return v ? (JSON.parse(v) as T) : null;
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // storage full or blocked — drafts are a convenience only
    }
  },
  remove(key: string) {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  },
};
