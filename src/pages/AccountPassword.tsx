import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LINK_ERROR, useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

/** Supabase's own floor is 6; ask for a little more. */
const MIN_LENGTH = 8;

/**
 * Choose a new password, in one of two ways:
 *
 *  - from a reset email: the link has already signed the user in, so only the
 *    new password is asked for — the old one is what they forgot;
 *  - signed in as usual: the current password is checked first, so a session
 *    left open on a shared computer is not enough to change it from this
 *    page. The server checks it too only when Supabase's "Require current
 *    password" is on (see CLAUDE.md).
 */
const AccountPassword = () => {
  const { user, loading, recovering, recoveryPending, hasPassword, updatePassword, sendPasswordReset } =
    useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [emailed, setEmailed] = useState(false);

  /** For a signed-in user who has forgotten the password they are asked for. */
  const emailResetLink = async () => {
    if (!user?.email) return;
    setBusy(true);
    await sendPasswordReset(user.email);
    setBusy(false);
    setEmailed(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (next.length < MIN_LENGTH) {
      toast.error(`Use at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (next !== confirm) {
      toast.error("The two new passwords don't match.");
      return;
    }
    setBusy(true);
    if (!recovering) {
      const { error } = await supabase.auth.signInWithPassword({
        email: user.email ?? "",
        password: current,
      });
      if (error) {
        setBusy(false);
        toast.error("Your current password is not right.");
        return;
      }
    }
    const { error, signedIn } = await updatePassword(next, recovering ? undefined : current);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (signedIn) {
      toast.success("Password updated.");
      navigate("/", { replace: true });
    } else {
      toast.success("Password updated. Sign in with your new password.");
      navigate("/auth", { replace: true });
    }
  };

  // A reset link is still being verified, or a reset is swapping the link's
  // session for a fresh sign-in.
  if (loading || recoveryPending || (busy && !user)) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  let body: React.ReactNode;
  if (!user) {
    body = (
      <>
        <CardHeader>
          <CardTitle>{LINK_ERROR ? "This link has expired" : "Set a new password"}</CardTitle>
          <CardDescription>
            {LINK_ERROR
              ? "Reset links work once and expire after a while. Ask for a new one."
              : "This page opens from the link in a password reset email. If the link has expired or was already used, ask for a new one."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Button asChild>
            <Link to="/auth?reset=1">Email me a reset link</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link to="/auth">Back to sign in</Link>
          </Button>
        </CardContent>
      </>
    );
  } else if (!recovering && !hasPassword) {
    body = (
      <>
        <CardHeader>
          <CardTitle>No password to change</CardTitle>
          <CardDescription>
            {emailed
              ? `We've emailed a link to ${user.email} for setting a password.`
              : "You sign in with Google. To sign in with a password as well, we can email you a link to set one."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {!emailed && (
            <Button onClick={() => void emailResetLink()} disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Email me a link
            </Button>
          )}
          <Button asChild variant="outline" className="w-full">
            <Link to="/">Back to practice</Link>
          </Button>
        </CardContent>
      </>
    );
  } else {
    body = (
      <>
        <CardHeader>
          <CardTitle>{recovering ? "Set a new password" : "Change password"}</CardTitle>
          <CardDescription>
            {recovering
              ? `Choose a new password for ${user.email}.`
              : `Signed in as ${user.email}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-3" onSubmit={(e) => void submit(e)}>
            {/* Lets password managers file the new password under the right account. */}
            <input type="hidden" name="username" autoComplete="username" value={user.email ?? ""} />
            {!recovering && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="current">Current password</Label>
                <Input
                  id="current"
                  type="password"
                  autoComplete="current-password"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  required
                />
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new">New password</Label>
              <Input
                id="new"
                type="password"
                autoComplete="new-password"
                minLength={MIN_LENGTH}
                value={next}
                onChange={(e) => setNext(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">At least {MIN_LENGTH} characters.</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirm">Confirm new password</Label>
              <Input
                id="confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="mt-1 w-full" disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {recovering ? "Save new password" : "Change password"}
            </Button>
            {!recovering &&
              (emailed ? (
                <p className="text-center text-sm text-muted-foreground">
                  We've emailed a reset link to {user.email}.
                </p>
              ) : (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => void emailResetLink()}
                  disabled={busy}
                >
                  Forgot your current password?
                </Button>
              ))}
            {!recovering && (
              <Button asChild variant="ghost" className="w-full">
                <Link to="/">Cancel</Link>
              </Button>
            )}
          </form>
        </CardContent>
      </>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <Card className="w-full max-w-sm">{body}</Card>
    </main>
  );
};

export default AccountPassword;
