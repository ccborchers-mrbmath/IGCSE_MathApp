import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

const NotFound = () => (
  <main className="flex min-h-screen items-center justify-center bg-background px-6">
    <div className="flex flex-col items-center gap-4 text-center">
      <h1 className="text-4xl font-bold">Page not found</h1>
      <p className="text-muted-foreground">
        That page doesn&rsquo;t exist. It may have moved.
      </p>
      <Button asChild>
        <Link to="/">Back to practice</Link>
      </Button>
    </div>
  </main>
);

export default NotFound;
