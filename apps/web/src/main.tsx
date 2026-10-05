import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles.css";
import { DemoShell } from "./demo/DemoShell";
import { demoFetch } from "./demo/backend";

const DEMO = import.meta.env.VITE_DEMO === "1";
if (DEMO) window.fetch = demoFetch as typeof window.fetch;   // coach API calls too

createRoot(document.getElementById("root")!).render(<StrictMode><ErrorBoundary>{DEMO ? <DemoShell /> : <App />}</ErrorBoundary></StrictMode>);
