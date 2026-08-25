import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Settings } from "lucide-react";

const Home = () => {
  const { user, userRole, isAdmin, loading, signOut } = useAuth();

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-16">
        <header className="flex flex-col gap-2">
          <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
            Cambridge IGCSE 0580 · Extended
          </p>
          <h1 className="text-4xl font-bold tracking-tight">IGCSE Maths</h1>
          <p className="max-w-prose text-muted-foreground">
            Past-paper practice with mark schemes, topic tracking and AI marking.
            Questions and mark schemes are free for everyone.
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Account</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Checking your session…
              </p>
            ) : user ? (
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <span className="font-medium">{user.email}</span>
                  <span className="flex items-center gap-2 text-sm text-muted-foreground">
                    Signed in
                    {userRole ? <Badge variant="secondary">{userRole}</Badge> : null}
                  </span>
                </div>
                <div className="flex gap-2">
                  {isAdmin && (
                    <Button asChild>
                      <Link to="/admin">
                        <Settings className="mr-2 h-4 w-4" />
                        Question bank
                      </Link>
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => void signOut()}>
                    Sign out
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-4">
                <p className="text-sm text-muted-foreground">
                  You are browsing as a guest. Sign in to save your progress.
                </p>
                <Button asChild>
                  <Link to="/auth">Sign in</Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-sm text-muted-foreground">
          347 questions are loaded and awaiting images. Practice opens in Phase 3.
        </p>
      </div>
    </main>
  );
};

export default Home;
