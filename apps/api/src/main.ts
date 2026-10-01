import { AnthropicClient } from "@fitness-os/ai";
import { buildApp } from "./app";
import { makeAuthenticator, makeBillingStore } from "./supabase";
import { FakeBillingProvider, type BillingDeps } from "./billing";

import { z } from "zod";
const Env = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  SUPABASE_URL: z.string().url(), SUPABASE_ANON_KEY: z.string().min(20),
  CORS_ORIGINS: z.string().default(""),
  ANTHROPIC_API_KEY: z.string().optional(), AI_MODEL: z.string().optional(),
  BILLING_PROVIDER: z.enum(["none", "fake"]).default("none"),
});
{
  const r = Env.safeParse(process.env);
  if (!r.success) { console.error("Invalid environment:", r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")); process.exit(1); }
  if (process.env.NODE_ENV === "production" && !r.data.CORS_ORIGINS) { console.error("CORS_ORIGINS must be set in production."); process.exit(1); }
}
const need = (k: string) => { const v = process.env[k]; if (!v) { console.error(`Missing required env var ${k} (see apps/api/.env.example)`); process.exit(1); } return v; };

const llm = process.env.ANTHROPIC_API_KEY && process.env.AI_MODEL
  ? new AnthropicClient({ apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.AI_MODEL })
  : null;
if (!llm) console.warn("ANTHROPIC_API_KEY/AI_MODEL not set: coach will answer from the rules engine only.");

let billing: BillingDeps | undefined;
const mode = process.env.BILLING_PROVIDER ?? "none";
if (mode === "fake") {
  if (process.env.NODE_ENV === "production") { console.error("BILLING_PROVIDER=fake is not allowed in production."); process.exit(1); }
  billing = { provider: new FakeBillingProvider(need("BILLING_FAKE_SECRET")), store: makeBillingStore(need("SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY")), appUrl: need("APP_URL") };
  console.warn("Billing uses the FAKE provider (development only).");
} else if (mode !== "none") {
  console.error(`Unsupported BILLING_PROVIDER "${mode}". No real payment provider is implemented yet.`); process.exit(1);
} else console.warn("Billing is not configured; checkout endpoints will answer 503.");

const app = buildApp(
  {
    authenticate: makeAuthenticator(need("SUPABASE_URL"), need("SUPABASE_ANON_KEY")),
    llm,
    billing,
    log: (event, meta) => console.log(JSON.stringify({ event, ...meta })),
  },
  { corsOrigins: (process.env.CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean) },
);
app.listen({ port: Number(process.env.PORT ?? 8787), host: "0.0.0.0" }).catch((e) => { console.error(e); process.exit(1); });
// Graceful shutdown: finish in-flight requests, then exit.
for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => { void app.close().then(() => process.exit(0), () => process.exit(1)); });
process.on("unhandledRejection", (e) => console.error("unhandledRejection", e instanceof Error ? e.message : "unknown"));
