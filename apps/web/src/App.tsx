import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import { isConfigured } from "./lib/supabase";
import { useProfile } from "./lib/profile";
import { Layout } from "./components/Layout";
import { ScreenState } from "./components/ScreenState";
import Login from "./pages/Login";
import Onboarding from "./pages/Onboarding";
import Dashboard from "./pages/Dashboard";
import Placeholder from "./pages/Placeholder";
import Nutrition from "./pages/Nutrition";
import Workout from "./pages/Workout";
import WorkoutSession from "./pages/WorkoutSession";
import Activity from "./pages/Activity";
import Progress from "./pages/Progress";
import Coach from "./pages/Coach";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import { Privacy, Terms } from "./pages/Legal";

function Gate() {
  const { session, loading } = useAuth();
  const { profile, loading: pLoading, error, reload } = useProfile();
  if (loading) return <ScreenState loading />;
  if (!session)
    return (
      <Routes>
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="*" element={<Login />} />
      </Routes>
    );
  if (pLoading || error) return <ScreenState loading={pLoading} error={error} onRetry={reload} />;
  if (!profile?.onboarding_completed) return <Onboarding onDone={reload} />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="nutrition" element={<Nutrition />} />
        <Route path="workout" element={<Workout />} />
        <Route path="workout/:id" element={<WorkoutSession />} />
        <Route path="activity" element={<Activity />} />
        <Route path="progress" element={<Progress />} />
        <Route path="coach" element={<Coach />} />
        <Route path="reports" element={<Reports />} />
        <Route path="settings" element={<Settings />} />
        <Route path="privacy" element={<Privacy />} />
        <Route path="terms" element={<Terms />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  if (!isConfigured)
    return (
      <div className="card auth">
        <h1>Configuration required</h1>
        <p>Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (see <code>.env.example</code>).</p>
      </div>
    );
  return (
    <BrowserRouter>
      <AuthProvider><Gate /></AuthProvider>
    </BrowserRouter>
  );
}
