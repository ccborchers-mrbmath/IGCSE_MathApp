import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

const Auth = () => {
  const { user, loading, signInWithGoogle, signInWithEmail, signUpWithEmail, sendPasswordReset } =
    useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"signin" | "reset" | "sent">(
    searchParams.get("reset") ? "reset" : "signin",
  );

  const redirect = searchParams.get("redirect") ?? "/";

  // Once a session exists — whether restored on load or delivered by the
  // OAuth callback — leave the auth page.
  useEffect(() => {
    if (!loading && user) navigate(redirect, { replace: true });
  }, [loading, user, redirect, navigate]);

  const handleGoogle = async () => {
    setBusy(true);
    const { error } = await signInWithGoogle(redirect === "/" ? undefined : redirect);
    // On success the browser navigates away, so only failures land here.
    if (error) {
      toast.error(error.message);
      setBusy(false);
    }
  };

  const handleEmail = async (mode: "signin" | "signup") => {
    if (!email || !password) {
      toast.error("Enter your email address and password.");
      return;
    }
    setBusy(true);
    const { error } =
      mode === "signin"
        ? await signInWithEmail(email, password)
        : await signUpWithEmail(email, password);
    setBusy(false);

    if (error) {
      toast.error(error.message);
      return;
    }
    if (mode === "signup") {
      toast.success("Check your inbox to confirm your email address.");
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      toast.error("Enter your email address.");
      return;
    }
    setBusy(true);
    const { error } = await sendPasswordReset(email);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setView("sent");
  };

  if (view !== "signin") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>{view === "sent" ? "Check your email" : "Reset your password"}</CardTitle>
            <CardDescription>
              {view === "sent"
                ? // Worded the same whether or not the address has an account, so
                  // the form cannot be used to find out who has signed up.
                  `If ${email} has an account, a link to set a new password is on its way. It works once and expires, so use it soon — and check your spam folder.`
                : "Enter the email address you signed up with and we'll send you a link to set a new password."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {view === "reset" ? (
              <form className="flex flex-col gap-3" onSubmit={(e) => void handleReset(e)}>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="reset-email">Email</Label>
                  <Input
                    id="reset-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Send reset link
                </Button>
                <Button type="button" variant="ghost" className="w-full" onClick={() => setView("signin")}>
                  Back to sign in
                </Button>
              </form>
            ) : (
              <Button variant="outline" className="w-full" onClick={() => setView("signin")}>
                Back to sign in
              </Button>
            )}
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>
            Questions and mark schemes are free without an account. Sign in to save
            your progress across devices.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Button variant="outline" onClick={() => void handleGoogle()} disabled={busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Continue with Google
          </Button>

          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-xs uppercase tracking-wide text-muted-foreground">or</span>
            <Separator className="flex-1" />
          </div>

          <Tabs defaultValue="signin">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Create account</TabsTrigger>
            </TabsList>

            <div className="mt-4 flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              <TabsContent value="signin" className="mt-1 flex flex-col gap-1">
                <Button
                  className="w-full"
                  onClick={() => void handleEmail("signin")}
                  disabled={busy}
                >
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Sign in
                </Button>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="self-center text-muted-foreground"
                  onClick={() => setView("reset")}
                >
                  Forgot password?
                </Button>
              </TabsContent>
              <TabsContent value="signup" className="mt-1">
                <Button
                  className="w-full"
                  onClick={() => void handleEmail("signup")}
                  disabled={busy}
                >
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Create account
                </Button>
              </TabsContent>
            </div>
          </Tabs>
        </CardContent>
      </Card>
    </main>
  );
};

export default Auth;
