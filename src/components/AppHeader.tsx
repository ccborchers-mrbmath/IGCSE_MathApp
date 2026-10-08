import { Link } from "react-router-dom";
import { PASSWORD_PATH, useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Settings, LogOut, BarChart3, KeyRound } from "lucide-react";

export const AppHeader = () => {
  const { user, isAdmin, loading, hasPassword, signOut } = useAuth();

  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-3">
        <Link to="/" className="flex flex-col leading-tight">
          <span className="text-[0.65rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Cambridge IGCSE 0580 · Extended
          </span>
          <span className="text-lg font-semibold tracking-tight">IGCSE Maths</span>
        </Link>

        <nav className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link to="/progress">
              <BarChart3 className="mr-2 h-4 w-4" />
              Progress
            </Link>
          </Button>
          {loading ? null : user ? (
            <>
              <span className="hidden text-sm text-muted-foreground sm:inline">{user.email}</span>
              {isAdmin && (
                <Button asChild variant="outline" size="sm">
                  <Link to="/admin">
                    <Settings className="mr-2 h-4 w-4" />
                    Question bank
                  </Link>
                </Button>
              )}
              {hasPassword && (
                <Button asChild variant="ghost" size="sm" title="Change password">
                  <Link to={PASSWORD_PATH}>
                    <KeyRound className="h-4 w-4 sm:mr-2" />
                    <span className="sr-only sm:not-sr-only">Password</span>
                  </Link>
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => void signOut()}>
                <LogOut className="mr-2 h-4 w-4" />
                Sign out
              </Button>
            </>
          ) : (
            <Button asChild size="sm">
              <Link to="/auth">Sign in</Link>
            </Button>
          )}
        </nav>
      </div>
    </header>
  );
};
