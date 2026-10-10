import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type User } from "./api";

interface Toast {
  id: number;
  text: string;
  error?: boolean;
}

interface AppCtx {
  user: User | null;
  userLoaded: boolean;
  setUser: (u: User | null) => void;
  /** open the sign-in dialog; resolves with the user once signed in (or null if dismissed) */
  requireSignIn: (reason?: string) => Promise<User | null>;
  signInPrompt: { reason?: string } | null;
  closeSignIn: (u: User | null) => void;
  toast: (text: string, error?: boolean) => void;
  toasts: Toast[];
}

const Ctx = createContext<AppCtx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userLoaded, setUserLoaded] = useState(false);
  const [signInPrompt, setSignInPrompt] = useState<{ reason?: string } | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const resolver = useRef<((u: User | null) => void) | null>(null);
  const toastId = useRef(0);

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setUserLoaded(true));
  }, []);

  const toast = useCallback((text: string, error?: boolean) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-2), { id, text, error }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), error ? 6000 : 3500);
  }, []);

  const requireSignIn = useCallback(
    (reason?: string) => {
      if (user) return Promise.resolve(user);
      setSignInPrompt({ reason });
      return new Promise<User | null>((resolve) => {
        resolver.current = resolve;
      });
    },
    [user],
  );

  const closeSignIn = useCallback((u: User | null) => {
    if (u) setUser(u);
    setSignInPrompt(null);
    resolver.current?.(u);
    resolver.current = null;
  }, []);

  const value = useMemo(
    () => ({ user, userLoaded, setUser, requireSignIn, signInPrompt, closeSignIn, toast, toasts }),
    [user, userLoaded, requireSignIn, signInPrompt, closeSignIn, toast, toasts],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApp outside provider");
  return c;
}
