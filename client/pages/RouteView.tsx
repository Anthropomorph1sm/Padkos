import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useApp } from "../context";
import { MapView } from "../components/MapView";
import { RouteFacts, RouteLine, VoteButtons } from "../components/RouteCard";
import { CostsPanel } from "../panels/CostsPanel";
import { toGpx, tripPoints } from "../../shared/formats";
import { googleMapsParts } from "../../shared/google";
import { findTolls } from "../../shared/tolls";
import type { FuelSettings, SavedRoute } from "../../shared/types";
import { download, slug } from "../format";

export function RouteView() {
  const { id, token } = useParams();
  const { requireSignIn, toast, user } = useApp();
  const navigate = useNavigate();
  const [route, setRoute] = useState<SavedRoute | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fuel, setFuel] = useState<FuelSettings | null>(null);
  const [passengers, setPassengers] = useState(1);
  const [copying, setCopying] = useState(false);

  useEffect(() => {
    setRoute(null);
    setError(null);
    (token ? api.shared(token) : api.getRoute(id!))
      .then((r) => {
        setRoute(r);
        setFuel(r.trip.settings.fuel);
        setPassengers(r.trip.settings.passengers);
      })
      .catch((e) => setError(e.status === 404 ? "This route doesn't exist, or its owner made it private." : e.message));
  }, [id, token, user?.id]);

  const points = useMemo(() => (route ? tripPoints(route.trip) : []), [route]);
  const tolls = useMemo(() => (route?.plan ? findTolls(route.plan.legs.map((l) => l.geometry), route.trip.tollOverrides) : []), [route]);
  const approximate = useMemo(() => {
    if (!route?.obscured) return [];
    return [route.trip.start, route.trip.settings.roundTrip ? null : route.trip.end, ...route.trip.stops].filter(
      (p): p is NonNullable<typeof p> => !!p?.approximate,
    );
  }, [route]);

  if (error)
    return (
      <main className="page">
        <div className="page-inner empty">
          <h2>Route not found</h2>
          <p style={{ margin: 0 }}>{error}</p>
          <Link className="btn" to="/community">
            Browse community routes
          </Link>
        </div>
      </main>
    );
  if (!route || !fuel)
    return (
      <main className="page">
        <div className="page-inner">
          <p className="muted row">
            <span className="spinner" /> Loading route…
          </p>
        </div>
      </main>
    );

  const copy = async () => {
    const u = await requireSignIn("Sign in to copy this route into your trips.");
    if (!u) return;
    setCopying(true);
    try {
      const c = await api.copyRoute(route.id, token);
      toast("Copied to your trips");
      navigate(`/?route=${c.id}`);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setCopying(false);
    }
  };

  const parts = googleMapsParts(points);

  return (
    <main className="view">
      <section className="panel" aria-label="Route details">
        <div className="panel-body">
          <div className="section">
            <div className="row" style={{ alignItems: "start" }}>
              {route.visibility !== "private" && <VoteButtons route={route} token={token} />}
              <div className="grow">
                <h2>{route.trip.title}</h2>
                <RouteLine from={route.startCity ?? route.trip.start?.name} to={route.endCity ?? route.trip.end?.name} />
                <RouteFacts r={route} />
              </div>
            </div>
            {route.trip.description && <p style={{ whiteSpace: "pre-wrap", maxWidth: "70ch" }}>{route.trip.description}</p>}
            {route.obscured && (
              <p className="small muted" style={{ margin: 0 }}>
                To protect the owner's privacy, the start and end are shown as towns and the route line stops short of them.
              </p>
            )}
            <div className="row wrap">
              {route.isOwner ? (
                <button className="btn primary" onClick={() => navigate(`/?route=${route.id}`)}>
                  Edit in planner
                </button>
              ) : (
                <button className="btn primary" onClick={copy} disabled={copying}>
                  {copying ? <span className="spinner" /> : null} Copy to my trips
                </button>
              )}
              <button className="btn" onClick={() => download(`${slug(route.trip.title)}.gpx`, toGpx(route.trip, route.plan), "application/gpx+xml")}>
                Download GPX
              </button>
            </div>
          </div>

          <div className="section">
            <h3>Stops</h3>
            <ol className="stops">
              {points.map((p, i) =>
                route.trip.settings.roundTrip && i === points.length - 1 && i > 0 ? null : (
                  <li key={`${p.id}-${i}`} className="stop" style={{ gridTemplateColumns: "26px 1fr" }}>
                    <span className={`plate ${i === 0 ? "start" : i === points.length - 1 ? "end" : ""}`}>
                      {i === 0 ? "A" : i === points.length - 1 ? "B" : i}
                    </span>
                    <div>
                      <div className="stop-name">{p.name}</div>
                      <div className="stop-meta">
                        {p.approximate ? "Exact place hidden by the owner, shown as the town" : p.address}
                        {p.stayMinutes ? ` ∙ stay ${p.stayMinutes} min` : ""}
                      </div>
                    </div>
                  </li>
                ),
              )}
            </ol>
          </div>

          {parts.length > 0 && (
            <div className="section">
              <h3>Open in Google Maps</h3>
              <ul className="list">
                {parts.map((p, i) => (
                  <li key={i} className="row">
                    <span className="plate">{i + 1}</span>
                    <span className="grow small">{p.label}</span>
                    <a className="btn small" href={p.url} target="_blank" rel="noreferrer">
                      Open
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {route.plan && (
            <div className="section">
              <h3>What it would cost you</h3>
              <CostsPanel
                distance={route.plan.distance}
                fuel={fuel}
                passengers={passengers}
                tolls={tolls}
                onFuel={(patch) => setFuel({ ...fuel, ...patch })}
                onPassengers={setPassengers}
              />
            </div>
          )}
        </div>
      </section>
      <div className="map-wrap">
        <MapView
          points={points}
          roundTrip={route.trip.settings.roundTrip}
          legs={route.plan?.legs ?? []}
          tolls={tolls}
          approximate={approximate}
          fitKey={route.id}
        />
      </div>
    </main>
  );
}
