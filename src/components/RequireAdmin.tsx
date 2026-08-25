import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

/**
 * Client-side convenience only. The real boundary is RLS: admin policies on
 * questions and on the exam-images bucket check has_role() in the database,
 * so a non-admin who reached this page anyway could still not write anything.
 */
export const RequireAdmin = ({ children }: { children: ReactNode }) => {
  const { user, isAdmin, loading } = useAuth();

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (!user || !isAdmin) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Admin only</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              {user
                ? "Your account does not have the admin role."
                : "Sign in with an admin account to manage the question bank."}
            </p>
            <Button asChild variant={user ? "outline" : "default"}>
              <Link to={user ? "/" : "/auth?redirect=/admin"}>
                {user ? "Back to practice" : "Sign in"}
              </Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return <>{children}</>;
};
