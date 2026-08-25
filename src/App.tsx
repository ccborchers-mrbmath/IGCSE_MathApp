import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Practice from "./pages/Practice";
import QuestionView from "./pages/QuestionView";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";
import AdminDashboard from "./pages/admin/AdminDashboard";
import BulkUpload from "./pages/admin/BulkUpload";
import { RequireAdmin } from "@/components/RequireAdmin";

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

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Practice />} />
          <Route path="/q/:id" element={<QuestionView />} />
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
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
