import { NavLink, Outlet } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useEffect } from "react";
import { useAdminRole } from "../lib/admin";
import { trackOnce } from "../lib/analytics";

const nav = [
  { to: "/", label: "Home", end: true },
  { to: "/nutrition", label: "Nutrition" },
  { to: "/workout", label: "Workout" },
  { to: "/progress", label: "Progress" },
  { to: "/coach", label: "Coach" },
];
const extra = [
  { to: "/activity", label: "Activity" },
  { to: "/reports", label: "Reports" },
  { to: "/subscription", label: "Subscription" },
  { to: "/settings", label: "Settings" },
];

export function Layout() {
  const { role } = useAdminRole();
  useEffect(() => { trackOnce("app_opened"); }, []);
  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Primary">
        <strong className="brand">Fitness OS</strong>
        {[...nav, ...extra, ...(role ? [{ to: "/admin", label: "Admin" }] : [])].map((n) => (
          <NavLink key={n.to} to={n.to} end={"end" in n} className="navlink">{n.label}</NavLink>
        ))}
        <button className="link" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </aside>
      <main className="content"><Outlet /></main>
      <nav className="bottomnav" aria-label="Primary mobile">
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} end={"end" in n} className="navlink">{n.label}</NavLink>
        ))}
      </nav>
    </div>
  );
}
