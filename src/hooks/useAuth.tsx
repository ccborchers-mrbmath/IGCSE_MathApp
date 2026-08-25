import { useEffect, useSyncExternalStore } from "react";
import type { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { logger } from "@/lib/logger";

type AuthRole = "admin" | "student" | null;

interface AuthState {
  loading: boolean;
  session: Session | null;
  user: User | null;
  userRole: AuthRole;
}

const subscribers = new Set<() => void>();

let authState: AuthState = {
  loading: true,
  session: null,
  user: null,
  userRole: null,
};

let initialized = false;

const notify = () => subscribers.forEach((cb) => cb());

const subscribe = (cb: () => void) => {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
};

const getSnapshot = () => authState;

const updateAuthState = (patch: Partial<AuthState>) => {
  authState = { ...authState, ...patch };
  notify();
};

/**
 * Resolve the user's role from `user_roles`. That table arrives in Phase 1;
 * until then the query errors and every signed-in user is treated as a
 * student, which is the correct fallback anyway.
 */
const fetchUserRole = async (userId: string): Promise<AuthRole> => {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (error || !data) return "student";
  const roles = data.map((r) => r.role as string);
  return roles.includes("admin") ? "admin" : "student";
};

const syncSession = (session: Session | null) => {
  if (!session?.user) {
    updateAuthState({ session: null, user: null, userRole: null, loading: false });
    return;
  }
  updateAuthState({ session, user: session.user, loading: false });
  // Resolve the role outside the auth callback — querying Supabase from
  // inside onAuthStateChange can deadlock on the client's internal lock.
  void fetchUserRole(session.user.id).then((role) => updateAuthState({ userRole: role }));
};

const initializeAuth = () => {
  if (initialized) return;
  initialized = true;

  supabase.auth.onAuthStateChange((_event, session) => syncSession(session));
  void supabase.auth.getSession().then(({ data: { session } }) => syncSession(session));
};

export const useAuth = () => {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    initializeAuth();
  }, []);

  /**
   * Native Supabase OAuth. `redirectTo` must be listed in the project's
   * auth redirect allowlist, including localhost and any Netlify preview
   * domains, or the callback is rejected.
   */
  const signInWithGoogle = async (redirectPath?: string) => {
    const redirectTo = new URL("/auth", window.location.origin);
    if (redirectPath) redirectTo.searchParams.set("redirect", redirectPath);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: redirectTo.toString() },
    });
    if (error) logger.error("Google sign-in failed", error);
    return { error };
  };

  const signInWithEmail = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const signUpWithEmail = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: new URL("/auth", window.location.origin).toString() },
    });
    return { error };
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (!error) {
      updateAuthState({ user: null, session: null, userRole: null, loading: false });
    }
    return { error };
  };

  return {
    user: snapshot.user,
    session: snapshot.session,
    userRole: snapshot.userRole,
    loading: snapshot.loading,
    isAdmin: snapshot.userRole === "admin",
    signInWithGoogle,
    signInWithEmail,
    signUpWithEmail,
    signOut,
  };
};
