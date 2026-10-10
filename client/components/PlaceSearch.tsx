import { useEffect, useId, useRef, useState } from "react";
import { api, type GeoResult } from "../api";

interface Props {
  placeholder: string;
  onPick: (r: GeoResult) => void;
  near?: { lat: number; lng: number };
  label: string;
  autoFocus?: boolean;
}

/** Autocomplete for South African places, addresses and attractions. */
export function PlaceSearch({ placeholder, onPick, near, label, autoFocus }: Props) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<GeoResult[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listId = useId();
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      setError(null);
      return;
    }
    const t = setTimeout(async () => {
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      setLoading(true);
      try {
        const r = await api.search(term, near, c.signal);
        setResults(r);
        setActive(0);
        setOpen(true);
        setError(r.length ? null : "No matches in South Africa");
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError((e as Error).message);
      } finally {
        if (ctrl.current === c) setLoading(false);
      }
    }, 280);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const pick = (r: GeoResult) => {
    onPick(r);
    setQ("");
    setResults([]);
    setOpen(false);
  };

  return (
    <div className="search">
      <label className="visually-hidden" htmlFor={`${listId}-input`}>
        {label}
      </label>
      <input
        id={`${listId}-input`}
        className="input"
        placeholder={placeholder}
        value={q}
        autoFocus={autoFocus}
        autoComplete="off"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={listId}
        aria-activedescendant={open && results[active] ? `${listId}-${active}` : undefined}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(results.length - 1, a + 1));
            setOpen(true);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === "Enter" && results[active]) {
            e.preventDefault();
            pick(results[active]);
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {loading && (
        <span className="spinner muted" style={{ position: "absolute", right: 10, top: 12 }} aria-label="Searching" />
      )}
      {open && results.length > 0 && (
        <ul className="search-results" id={listId} role="listbox">
          {results.map((r, i) => (
            <li
              key={`${r.lat},${r.lng},${i}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(r);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span>{r.name}</span>
              {r.address && <span className="addr">{r.address}</span>}
            </li>
          ))}
        </ul>
      )}
      {error && q.trim().length >= 2 && !loading && <div className="small muted" style={{ marginTop: 4 }}>{error}</div>}
    </div>
  );
}
