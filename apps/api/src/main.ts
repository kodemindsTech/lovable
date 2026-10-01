import { AnthropicClient } from "@fitness-os/ai";
import { buildApp } from "./app";
import { makeAuthenticator, makeBillingStore } from "./supabase";
import { FakeBillingProvider, type BillingDeps } from "./billing";

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
