import { lazy, Suspense } from "react";
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
const Coach = lazy(() => import("./pages/Coach"));
const Reports = lazy(() => import("./pages/Reports"));
const Subscription = lazy(() => import("./pages/Subscription"));
import Pricing from "./pages/Pricing";
import { EntitlementsProvider } from "./lib/entitlements";
const AdminLayout = lazy(() => import("./pages/admin/AdminLayout"));
const Overview = lazy(() => import("./pages/admin/Overview"));
const AdminUsers = lazy(() => import("./pages/admin/Users"));
const FoodsAdmin = lazy(() => import("./pages/admin/Catalog").then((m) => ({ default: m.FoodsAdmin })));
const ExercisesAdmin = lazy(() => import("./pages/admin/Catalog").then((m) => ({ default: m.ExercisesAdmin })));
const PricingAdmin = lazy(() => import("./pages/admin/Pricing"));
const AiMonitoring = lazy(() => import("./pages/admin/AiMonitoring"));
const FeedbackAdmin = lazy(() => import("./pages/admin/Feedback"));
const Announcements = lazy(() => import("./pages/admin/Announcements"));
const FlagsAdmin = lazy(() => import("./pages/admin/System").then((m) => ({ default: m.FlagsAdmin })));
const SettingsAdmin = lazy(() => import("./pages/admin/System").then((m) => ({ default: m.SettingsAdmin })));
const AdminsAdmin = lazy(() => import("./pages/admin/Admins").then((m) => ({ default: m.AdminsAdmin })));
const AuditAdmin = lazy(() => import("./pages/admin/Admins").then((m) => ({ default: m.AuditAdmin })));
import { AdminRoleProvider } from "./lib/admin";
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
        <Route path="/pricing" element={<Pricing />} />
        <Route path="*" element={<Login />} />
      </Routes>
    );
  if (pLoading || error) return <ScreenState loading={pLoading} error={error} onRetry={reload} />;
  if (!profile?.onboarding_completed) return <Onboarding onDone={reload} />;
  return (
    <EntitlementsProvider>
    <AdminRoleProvider>
    <Suspense fallback={<ScreenState loading />}>
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
        <Route path="admin" element={<AdminLayout />}>
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview" element={<Overview />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="foods" element={<FoodsAdmin />} />
          <Route path="exercises" element={<ExercisesAdmin />} />
          <Route path="pricing" element={<PricingAdmin />} />
          <Route path="ai" element={<AiMonitoring />} />
          <Route path="feedback" element={<FeedbackAdmin />} />
          <Route path="announcements" element={<Announcements />} />
          <Route path="flags" element={<FlagsAdmin />} />
          <Route path="settings" element={<SettingsAdmin />} />
          <Route path="admins" element={<AdminsAdmin />} />
          <Route path="audit" element={<AuditAdmin />} />
        </Route>
        <Route path="subscription" element={<Subscription />} />
        <Route path="pricing" element={<Pricing />} />
        <Route path="privacy" element={<Privacy />} />
        <Route path="terms" element={<Terms />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
    </Suspense>
    </AdminRoleProvider>
    </EntitlementsProvider>
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
