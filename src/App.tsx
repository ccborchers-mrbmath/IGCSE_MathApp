import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import Practice from "./pages/Practice";
import { RequireAdmin } from "@/components/RequireAdmin";

// Practice is the landing route, so it stays in the entry chunk — lazily
// loading the first thing every visitor sees would only add a round trip.
// Everything else splits out. The admin pages matter most: bulk upload pulls
// in the whole ingestion path, and no student will ever open it.
const QuestionView = lazy(() => import("./pages/QuestionView"));
const Progress = lazy(() => import("./pages/Progress"));
const Auth = lazy(() => import("./pages/Auth"));
const NotFound = lazy(() => import("./pages/NotFound"));
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard"));
const BulkUpload = lazy(() => import("./pages/admin/BulkUpload"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // One retry, not three. A student on a flaky connection should see an
      // actionable error in a couple of seconds rather than sit on a skeleton
      // while three attempts back off.
      retry: 1,
      retryDelay: 750,
      // The bank changes only when an admin publishes, so refetching every
      // time the tab regains focus is pure egress for no benefit.
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000,
    },
  },
});

const RouteFallback = () => (
  <div className="mx-auto flex max-w-4xl flex-col gap-4 px-6 py-8">
    <Skeleton className="h-8 w-64" />
    <Skeleton className="h-96 w-full" />
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<Practice />} />
            <Route path="/q/:id" element={<QuestionView />} />
            <Route path="/progress" element={<Progress />} />
            <Route path="/auth" element={<Auth />} />
            <Route
              path="/admin"
              element={
                <RequireAdmin>
                  <AdminDashboard />
                </RequireAdmin>
              }
            />
            <Route
              path="/admin/upload"
              element={
                <RequireAdmin>
                  <BulkUpload />
                </RequireAdmin>
              }
            />
            {/* Add all custom routes above the catch-all "*" route. */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
