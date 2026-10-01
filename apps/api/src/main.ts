import { AnthropicClient } from "@fitness-os/ai";
import { buildApp } from "./app";
import { makeAuthenticator } from "./supabase";

const need = (k: string) => { const v = process.env[k]; if (!v) { console.error(`Missing required env var ${k} (see apps/api/.env.example)`); process.exit(1); } return v; };

const llm = process.env.ANTHROPIC_API_KEY && process.env.AI_MODEL
  ? new AnthropicClient({ apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.AI_MODEL })
  : null;
if (!llm) console.warn("ANTHROPIC_API_KEY/AI_MODEL not set: coach will answer from the rules engine only.");

const app = buildApp(
  {
    authenticate: makeAuthenticator(need("SUPABASE_URL"), need("SUPABASE_ANON_KEY")),
    llm,
    log: (event, meta) => console.log(JSON.stringify({ event, ...meta })),
  },
  { corsOrigins: (process.env.CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean) },
);
app.listen({ port: Number(process.env.PORT ?? 8787), host: "0.0.0.0" }).catch((e) => { console.error(e); process.exit(1); });
