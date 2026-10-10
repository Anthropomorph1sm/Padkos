import { NavLink, Route, Routes, Link } from "react-router-dom";
import { AppProvider, useApp } from "./context";
import { api } from "./api";
import { SignInDialog } from "./components/SignInDialog";
import { Planner } from "./pages/Planner";
import { MyTrips } from "./pages/MyTrips";
import { Community } from "./pages/Community";
import { RouteView } from "./pages/RouteView";

function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="6" fill="#3a454b" />
      <path d="M9 30 L14 2 M23 30 L18 2" stroke="#F2B705" strokeWidth="2.5" />
      <path d="M16 6v4M16 15v4M16 24v4" stroke="#fff" strokeWidth="2" />
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
