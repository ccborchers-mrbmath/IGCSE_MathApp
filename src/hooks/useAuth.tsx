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
   * the current one is not asked for. See `recovery` below for what earns it.
   */
  recovering: boolean;
  /** The URL looks like a reset link whose verification has not finished. */
  recoveryPending: boolean;
}

/** Where the link in a password-reset email lands. */
export const PASSWORD_PATH = "/account/password";

/**
 * Did this tab load from a reset link? Read before the client strips the
 * token from the URL. Supabase broadcasts PASSWORD_RECOVERY to every open tab
 * of the app; only the tab the link opened in may act on it.
 */
const looksLikeRecovery =
  typeof window !== "undefined" &&
  /[#&]type=recovery\b/.test(window.location.hash) &&
  /[#&]access_token=/.test(window.location.hash);

/** An expired or already-used email link arrives with this in the URL. */
export const LINK_ERROR =
  typeof window !== "undefined" && /[#&]error_code=/.test(window.location.hash);

/**
 * Recovery mode, and what earns it.
 *
 * The client fires PASSWORD_RECOVERY whenever a URL carries a valid access
 * token and `type=recovery` — including the reset link replayed from browser
 * history, since the token outlives the reset. So recovery is honoured only
 * in the tab the link opened in, and is pinned to that link's session: it
 * ends when the session changes (another account, a fresh sign-in) or a
 * password is set anywhere. Saving the new password then revokes the link's
 * session at the server, so a replayed link no longer signs anyone in.
 *
 * Kept per tab in sessionStorage so a reload of the form does not drop the
 * user back to "enter your current password" — the one they forgot.
 */
const RECOVERY_KEY = "igcse.passwordRecovery";
interface RecoveryMark {
  userId: string;
  sessionId: string | null;
}

/** The `session_id` claim of an access token. */
const sessionIdOf = (session: Session | null): string | null => {
  try {
    const payload = session?.access_token.split(".")[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return (JSON.parse(json) as { session_id?: string }).session_id ?? null;
  } catch {
    return null;
  }
};

const readMark = (): RecoveryMark | null => {
  try {
    const raw = sessionStorage.getItem(RECOVERY_KEY);
    return raw ? (JSON.parse(raw) as RecoveryMark) : null;
  } catch {
    return null;
  }
};
const writeMark = (mark: RecoveryMark | null) => {
  try {
    if (mark) sessionStorage.setItem(RECOVERY_KEY, JSON.stringify(mark));
    else sessionStorage.removeItem(RECOVERY_KEY);
  } catch {
    /* recovery then lasts only until a reload */
  }
};
let recoveryMark: RecoveryMark | null = typeof window !== "undefined" ? readMark() : null;

const markHolds = (session: Session | null) =>
  Boolean(
    recoveryMark &&
      session?.user &&
      recoveryMark.userId === session.user.id &&
      recoveryMark.sessionId === sessionIdOf(session),
  );

const endRecovery = () => {
  recoveryMark = null;
  writeMark(null);
};

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
    endRecovery();
    updateAuthState({ session: null, user: null, userRole: null, loading: false, recovering: false });
    return;
  }
  if (recoveryMark && !markHolds(session)) endRecovery();
  updateAuthState({ session, user: session.user, loading: false, recovering: markHolds(session) });
  // Resolve the role outside the auth callback — querying Supabase from
  // inside onAuthStateChange can deadlock on the client's internal lock.
  void fetchUserRole(session.user.id).then((role) => updateAuthState({ userRole: role }));
};

const initializeAuth = () => {
  if (initialized) return;
  initialized = true;

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY" && looksLikeRecovery && session?.user) {
      recoveryMark = { userId: session.user.id, sessionId: sessionIdOf(session) };
      writeMark(recoveryMark);
      updateAuthState({ recoveryPending: false });
    }
    // A password set in any tab ends recovery in all of them.
    if (event === "USER_UPDATED") endRecovery();
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
      endRecovery();
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

  /**
   * Set a new password. After a reset link, the link's session is then
   * revoked and replaced by a fresh sign-in with the new password: the link's
   * token is still in the browser's history, and without this, Back and
   * reload within the hour would put the form back into recovery mode for
   * whoever is at the keyboard next.
   *
   * `currentPassword` goes to the server, which checks it when Supabase's
   * "Require current password" is on. A reset link's session is exempt, so
   * recovery sends none.
   */
  const updatePassword = async (password: string, currentPassword?: string) => {
    const wasRecovering = authState.recovering;
    const email = authState.user?.email;
    const { error } = await supabase.auth.updateUser({
      password,
      ...(currentPassword ? { current_password: currentPassword } : {}),
      data: { has_password: true },
    });
    if (error) {
      // With "Secure password change" on, a reset link's session over a day
      // old needs a nonce this form never asks for. The link is spent: let
      // the tab go rather than hold it on a form that cannot save.
      if (wasRecovering && error.code === "reauthentication_needed") {
        endRecovery();
        await supabase.auth.signOut({ scope: "local" });
        return { error, signedIn: false, linkExpired: true };
      }
      return { error, signedIn: true, linkExpired: false };
    }
    endRecovery();
    updateAuthState({ recovering: false });
    if (!wasRecovering || !email) return { error: null, signedIn: true, linkExpired: false };

    await supabase.auth.signOut({ scope: "local" });
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) logger.error("Sign-in after password reset failed", signInError);
    return { error: null, signedIn: !signInError, linkExpired: false };
  };

  return {
    user: snapshot.user,
    session: snapshot.session,
    userRole: snapshot.userRole,
    loading: snapshot.loading,
    isAdmin: snapshot.userRole === "admin",
    recovering: snapshot.recovering,
    recoveryPending: snapshot.recoveryPending,
    /**
     * Can sign in with a password: an email identity, or a Google account
     * that has since set one through a reset email (which adds no identity).
     */
    hasPassword: Boolean(
      snapshot.user?.identities?.some((i) => i.provider === "email") ||
        snapshot.user?.app_metadata?.providers?.includes("email") ||
        snapshot.user?.user_metadata?.has_password,
    ),
    signInWithGoogle,
    signInWithEmail,
    signUpWithEmail,
    signOut,
    sendPasswordReset,
    updatePassword,
  };
};
