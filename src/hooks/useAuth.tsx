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
  /**
   * Signed in by a password-reset link and yet to choose a new password, so
   * the current one is not asked for. Set only by Supabase's PASSWORD_RECOVERY
   * event, which fires after the link's token has been verified: the URL
   * alone is not evidence, or anyone with an open session could append
   * `#type=recovery` and skip the current-password check.
   */
  recovering: boolean;
  /** The URL looks like a reset link whose verification has not finished. */
  recoveryPending: boolean;
}

/** Where the link in a password-reset email lands. */
export const PASSWORD_PATH = "/account/password";

/** Only decides whether to show a spinner instead of the wrong form. */
const looksLikeRecovery =
  typeof window !== "undefined" &&
  /[#&]type=recovery\b/.test(window.location.hash) &&
  /[#&]access_token=/.test(window.location.hash);

const subscribers = new Set<() => void>();

let authState: AuthState = {
  loading: true,
  session: null,
  user: null,
  userRole: null,
  recovering: false,
  recoveryPending: looksLikeRecovery,
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
    updateAuthState({ session: null, user: null, userRole: null, loading: false, recovering: false });
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

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") updateAuthState({ recovering: true, recoveryPending: false });
    syncSession(session);
  });
  void supabase.auth.getSession().then(({ data: { session } }) => {
    syncSession(session);
    // The client announces a recovery on a zero-delay timer queued before
    // getSession resolves, so by this timer it has fired if it ever will.
    setTimeout(() => updateAuthState({ recoveryPending: false }), 0);
  });
};

// Listen from the moment the module loads, not from the first render: the
// client verifies a reset link as soon as it is created, and a subscriber
// that arrives after PASSWORD_RECOVERY is never told about it.
if (typeof window !== "undefined") initializeAuth();

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
      updateAuthState({ user: null, session: null, userRole: null, loading: false, recovering: false });
    }
    return { error };
  };

  /**
   * Email a password-reset link. The link signs the user in and lands on the
   * set-password page, which must be in the auth redirect allowlist; if it is
   * not, Supabase falls back to the Site URL and the app redirects from there.
   */
  const sendPasswordReset = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: new URL(PASSWORD_PATH, window.location.origin).toString(),
    });
    if (error) logger.error("Password reset email failed", error);
    return { error };
  };

  const updatePassword = async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (!error) updateAuthState({ recovering: false });
    return { error };
  };

  return {
    user: snapshot.user,
    session: snapshot.session,
    userRole: snapshot.userRole,
    loading: snapshot.loading,
    isAdmin: snapshot.userRole === "admin",
    recovering: snapshot.recovering,
    recoveryPending: snapshot.recoveryPending,
    /** Has an email-and-password identity, as opposed to Google alone. */
    hasPassword: Boolean(
      snapshot.user?.identities?.some((i) => i.provider === "email") ??
        snapshot.user?.app_metadata?.providers?.includes("email"),
    ),
    signInWithGoogle,
    signInWithEmail,
    signUpWithEmail,
    signOut,
    sendPasswordReset,
    updatePassword,
  };
};
