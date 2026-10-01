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

function Gate() {
  const { session, loading } = useAuth();
  const { profile, loading: pLoading, error, reload } = useProfile();
  if (loading) return <ScreenState loading />;
  if (!session) return <Login />;
  if (pLoading || error) return <ScreenState loading={pLoading} error={error} onRetry={reload} />;
  if (!profile?.onboarding_completed) return <Onboarding onDone={reload} />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="nutrition" element={<Placeholder title="Nutrition" phase="Phase 2" />} />
        <Route path="workout" element={<Placeholder title="Workouts" phase="Phase 3" />} />
        <Route path="activity" element={<Placeholder title="Activity" phase="Phase 4" />} />
        <Route path="progress" element={<Placeholder title="Progress" phase="Phase 4" />} />
        <Route path="coach" element={<Placeholder title="AI Coach" phase="Phase 6" />} />
        <Route path="reports" element={<Placeholder title="Reports" phase="Phase 7" />} />
        <Route path="settings" element={<Placeholder title="Settings" phase="Phase 1 follow-up" />} />
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
