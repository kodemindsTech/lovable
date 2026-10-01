import { NavLink, Outlet, Navigate } from "react-router-dom";
import { TABS, canSee, useAdminRole } from "../../lib/admin";
import { ScreenState } from "../../components/ScreenState";

export default function AdminLayout() {
  const { role, loading } = useAdminRole();
  if (loading) return <ScreenState loading />;
  if (!role) return <Navigate to="/" replace />;   // non-admins never see the panel (the DB would refuse them anyway)
  const tabs = TABS.filter((t) => canSee(role, t.roles));
  return (
    <>
      <h1>Admin <span className="chip">{role}</span></h1>
      <nav className="admin-tabs" aria-label="Admin sections">
        {tabs.map((t) => <NavLink key={t.path} to={`/admin/${t.path}`} className="navlink">{t.label}</NavLink>)}
      </nav>
      <Outlet />
    </>
  );
}
