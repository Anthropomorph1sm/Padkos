import { NavLink, Route, Routes, Link } from "react-router-dom";
import { AppProvider, useApp } from "./context";
import { api } from "./api";
import { SignInDialog } from "./components/SignInDialog";
import { Planner } from "./pages/Planner";
import { MyTrips } from "./pages/MyTrips";
import { Community } from "./pages/Community";
import { RouteView } from "./pages/RouteView";

function BrandMark() {
  // same drawing as public/favicon.svg: a road running to a sunrise
  return (
    <svg className="brand-mark" viewBox="0 0 64 64" aria-hidden="true">
      <clipPath id="brand-tile">
        <rect width="64" height="64" rx="14" />
      </clipPath>
      <g clipPath="url(#brand-tile)">
        <rect width="64" height="64" fill="#232B2F" />
        <circle cx="32" cy="25" r="11" fill="#F2B705" />
        <rect y="25" width="64" height="39" fill="#3A454B" />
        <path d="M6 64 L29.5 25 H34.5 L58 64 Z" fill="#232B2F" />
        <path d="M7.5 64 L30 25 M56.5 64 L34 25" stroke="#F2B705" strokeWidth="3.5" />
        <path d="M32 29v3.5 M32 37v5.5 M32 48v8.5" stroke="#fff" strokeWidth="2.6" />
      </g>
    </svg>
  );
}

function TopBar() {
  const { user, setUser, requireSignIn, toast } = useApp();
  return (
    <header className="topbar">
      <Link to="/" className="brand" aria-label="Padkos home">
        <BrandMark />
        Padkos
      </Link>
      <nav className="nav" aria-label="Main">
        <NavLink to="/" end>
          Plan a trip
        </NavLink>
        <NavLink to="/trips">My trips</NavLink>
        <NavLink to="/community">Community routes</NavLink>
      </nav>
      <div className="account">
        {user ? (
          <>
            <span>Signed in as {user.username}</span>
            <button
              className="btn small"
              onClick={async () => {
                await api.logout().catch(() => undefined);
                setUser(null);
                toast("Signed out");
              }}
            >
              Sign out
            </button>
          </>
        ) : (
          <button className="btn small" onClick={() => requireSignIn()}>
            Sign in
          </button>
        )}
      </div>
    </header>
  );
}

function Toasts() {
  const { toasts } = useApp();
  return (
    <div aria-live="polite">
      {toasts.slice(-1).map((t) => (
        <div key={t.id} className={`toast${t.error ? " error" : ""}`} role={t.error ? "alert" : "status"}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function App() {
  return (
    <AppProvider>
      <div className="shell">
        <TopBar />
        <Routes>
          <Route path="/" element={<Planner />} />
          <Route path="/trips" element={<MyTrips />} />
          <Route path="/community" element={<Community />} />
          <Route path="/r/:id" element={<RouteView />} />
          <Route path="/s/:token" element={<RouteView />} />
          <Route
            path="*"
            element={
              <main className="page">
                <div className="page-inner empty">
                  <h2>This road doesn't go anywhere</h2>
                  <Link className="btn" to="/">
                    Plan a trip
                  </Link>
                </div>
              </main>
            }
          />
        </Routes>
      </div>
      <SignInDialog />
      <Toasts />
    </AppProvider>
  );
}
