import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useApp } from "../context";

export function SignInDialog() {
  const { signInPrompt, closeSignIn, toast } = useApp();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (signInPrompt) {
      setError(null);
      setPassword("");
      setTimeout(() => firstField.current?.focus(), 0);
    }
  }, [signInPrompt]);

  useEffect(() => {
    if (!signInPrompt) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeSignIn(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [signInPrompt, closeSignIn]);

  if (!signInPrompt) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = mode === "login" ? await api.login(username, password) : await api.register(username, password);
      toast(mode === "login" ? `Welcome back, ${u.username}` : `Account created — welcome, ${u.username}`);
      closeSignIn(u);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeSignIn(null)}>
      <form className="modal" role="dialog" aria-modal="true" aria-labelledby="signin-title" onSubmit={submit}>
        <h2 id="signin-title">{mode === "login" ? "Sign in" : "Create an account"}</h2>
        {signInPrompt.reason && <p className="muted">{signInPrompt.reason}</p>}
        <label className="field">
          Username
          <input
            ref={firstField}
            className="input"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            minLength={3}
            maxLength={32}
          />
        </label>
        <label className="field">
          Password
          <input
            className="input"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={mode === "register" ? 8 : 1}
          />
          {mode === "register" && <span className="muted small">At least 8 characters.</span>}
        </label>
        {error && <div className="notice error">{error}</div>}
        <div className="row">
          <button className="btn primary grow" type="submit" disabled={busy}>
            {busy ? <span className="spinner" /> : mode === "login" ? "Sign in" : "Create account"}
          </button>
          <button className="btn" type="button" onClick={() => closeSignIn(null)}>
            Cancel
          </button>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          {mode === "login" ? "New to Padkos? " : "Already have an account? "}
          <button
            type="button"
            className="btn ghost small"
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError(null);
            }}
          >
            {mode === "login" ? "Create an account" : "Sign in instead"}
          </button>
        </p>
      </form>
    </div>
  );
}
