import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useApp } from "../context";
import { RouteLine } from "../components/RouteCard";
import type { SavedRouteSummary } from "../../shared/types";
import { duration, km, relativeDate } from "../format";

const VIS_LABEL = { private: "Private", unlisted: "Link only", public: "Public" } as const;

export function MyTrips() {
  const { user, userLoaded, requireSignIn, toast } = useApp();
  const navigate = useNavigate();
  const [routes, setRoutes] = useState<SavedRouteSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    api
      .myRoutes()
      .then(setRoutes)
      .catch((e) => setError(e.message));
  }, [user]);

  if (userLoaded && !user) {
    return (
      <main className="page">
        <div className="page-inner empty">
          <h2>Your saved trips live here</h2>
          <p style={{ margin: 0 }}>Sign in to save trips, come back to them later and share them with friends.</p>
          <button className="btn primary" onClick={() => requireSignIn()}>
            Sign in
          </button>
        </div>
      </main>
    );
  }

  const remove = async (r: SavedRouteSummary) => {
    if (!confirm(`Delete "${r.title}"? This can't be undone${r.visibility !== "private" ? " and its share link will stop working" : ""}.`)) return;
    try {
      await api.deleteRoute(r.id);
      setRoutes((list) => list?.filter((x) => x.id !== r.id) ?? null);
      toast("Trip deleted");
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  const copyLink = async (r: SavedRouteSummary) => {
    const url = `${location.origin}/s/${r.shareToken}`;
    try {
      await navigator.clipboard.writeText(url);
      toast("Share link copied");
    } catch {
      prompt("Copy this link", url);
    }
  };

  return (
    <main className="page">
      <div className="page-inner">
        <div className="page-head">
          <h1>My trips</h1>
          <Link className="btn go" to="/?new=1">
            Plan a trip
          </Link>
        </div>
        {error && <div className="notice error">{error}</div>}
        {routes && routes.length === 0 && (
          <div className="empty">
            <h3>No saved trips yet</h3>
            <p style={{ margin: 0 }}>Plan a route, then save it from the Save &amp; share tab.</p>
          </div>
        )}
        {routes && routes.length > 0 && (
          <ul className="route-cards">
            {routes.map((r) => (
              <li key={r.id} className="route-card">
                <span className={`badge-vis ${r.visibility}`}>{VIS_LABEL[r.visibility]}</span>
                <div>
                  <Link className="title" to={`/?route=${r.id}`}>
                    {r.title}
                  </Link>
                  <RouteLine from={r.startCity} to={r.endCity} />
                  <div className="facts">
                    {r.distance != null && <span>{km(r.distance)}</span>}
                    {r.duration != null && <span>{duration(r.duration)} driving</span>}
                    <span>
                      {r.stopCount} stop{r.stopCount === 1 ? "" : "s"}
                    </span>
                    {r.visibility !== "private" && (
                      <span>
                        {r.score} point{Math.abs(r.score) === 1 ? "" : "s"} ({r.upvotes} up, {r.downvotes} down)
                      </span>
                    )}
                    <span>updated {relativeDate(r.updatedAt)}</span>
                  </div>
                </div>
                <div className="row wrap card-actions">
                  <button className="btn small" onClick={() => navigate(`/?route=${r.id}`)}>
                    Open
                  </button>
                  {r.shareToken && (
                    <button className="btn small" onClick={() => copyLink(r)}>
                      Copy link
                    </button>
                  )}
                  <button className="btn small danger" onClick={() => remove(r)}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {!routes && !error && user && (
          <p className="muted row">
            <span className="spinner" /> Loading your trips…
          </p>
        )}
      </div>
    </main>
  );
}
