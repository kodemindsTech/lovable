import { Link } from "react-router-dom";
import { PlanCards } from "../components/PlanCards";

export default function Pricing() {
  return (
    <div className="content">
      <h1>Pricing</h1>
      <p className="muted">Start free. Upgrade when you want the AI coach and deeper insights.</p>
      <PlanCards renderAction={(p) => (p.id === "free" ? <Link className="btn" to="/">Start free</Link> : <Link className="btn" to="/">Sign up to subscribe</Link>)} />
    </div>
  );
}
