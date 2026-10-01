// Copies packages/db/migrations/*.sql into supabase/migrations/ using the CLI's "<version>_<name>.sql" naming,
// so `supabase db push` / `supabase db reset` can apply them. Idempotent. NOT yet run against a real project.
import { cpSync, mkdirSync, readdirSync } from "node:fs";
const src = "packages/db/migrations", dst = "supabase/migrations";
mkdirSync(dst, { recursive: true });
let n = 0;
for (const f of readdirSync(src).filter((x) => x.endsWith(".sql")).sort()) {
  const m = /^(\d{4})_(.+)\.sql$/.exec(f); if (!m) continue;
  cpSync(`${src}/${f}`, `${dst}/2026010100${m[1]}_${m[2]}.sql`); n++;   // fixed prefix keeps ordering stable
}
console.log(`Copied ${n} migrations to ${dst}. Seed data: packages/db/seed/*.sql (apply after migrations, e.g. supabase/seed.sql).`);
