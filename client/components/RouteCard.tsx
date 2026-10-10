import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useApp } from "../context";
import type { SavedRouteSummary } from "../../shared/types";
import { duration, km, relativeDate } from "../format";

export function VoteButtons({ route, token, onChange }: { route: SavedRouteSummary; token?: string; onChange?: (r: SavedRouteSummary) => void }) {
  const { requireSignIn, toast } = useApp();
  const [state, setState] = useState({ score: route.score, myVote: route.myVote ?? 0 });
  const [busy, setBusy] = useState(false);

  const vote = async (v: 1 | -1) => {
    if (route.isOwner) {
      toast("You can't vote on your own route", true);
      return;
    }
    const u = await requireSignIn("Sign in to vote on routes.");
    if (!u) return;
    const value = state.myVote === v ? 0 : v;
    setBusy(true);
    try {
      const r = await api.vote(route.id, value, token);
      setState({ score: r.score, myVote: r.myVote });
      onChange?.({ ...route, score: r.score, upvotes: r.upvotes, downvotes: r.downvotes, myVote: r.myVote });
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="vote" aria-label={`Score ${state.score}`}>
      <button className="up" aria-pressed={state.myVote === 1} aria-label="Upvote" title="Upvote" disabled={busy} onClick={() => vote(1)}>
        ▲
      </button>
      <strong>{state.score}</strong>
      <button className="down" aria-pressed={state.myVote === -1} aria-label="Downvote" title="Downvote" disabled={busy} onClick={() => vote(-1)}>
        ▼
      </button>
    </div>
  );
}

export function RouteLine({ from, to }: { from?: string; to?: string }) {
  return (
    <div className="route-line">
      <span>{from ?? "Somewhere"}</span>
      <span className="dash" aria-hidden="true" />
      <span className="visually-hidden">to</span>
      <span>{to ?? "Somewhere"}</span>
    </div>
  );
}

export function RouteFacts({ r }: { r: SavedRouteSummary }) {
  return (
    <div className="facts">
      {r.distance != null && <span>{km(r.distance)}</span>}
      {r.duration != null && <span>{duration(r.duration)} driving</span>}
      <span>
        {r.stopCount} stop{r.stopCount === 1 ? "" : "s"}
      </span>
      <span>by {r.owner}</span>
      <span>{relativeDate(r.createdAt)}</span>
    </div>
  );
}

export function RouteCard({ r }: { r: SavedRouteSummary }) {
  return (
    <li className="route-card">
      <VoteButtons route={r} />
      <div>
        <Link className="title" to={`/r/${r.id}`}>
          {r.title}
        </Link>
        <RouteLine from={r.startCity} to={r.endCity} />
        {r.description && (
          <p className="small" style={{ margin: "4px 0 2px", maxWidth: "70ch" }}>
            {r.description.length > 180 ? `${r.description.slice(0, 180)}…` : r.description}
          </p>
        )}
        <RouteFacts r={r} />
      </div>
      <span />
    </li>
  );
}
