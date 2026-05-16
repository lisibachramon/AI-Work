// Runs drizzle-kit generated migrations PLUS the raw SQL bootstrap
// (extensions, FTS config, trigger, pg_trgm + HNSW indexes) which Drizzle
// can't express. Idempotent: safe to run on every container start.
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");

  const sql = postgres(url, { max: 1 });

  // 1. Extensions + FTS config. Always run; everything is IF NOT EXISTS / OR REPLACE.
  const bootstrapSql = readFileSync(resolve(__dirname, "bootstrap.sql"), "utf8");
  await sql.unsafe(bootstrapSql);

  // 2. drizzle-generated migrations
  const db = drizzle(sql);
  await migrate(db, { migrationsFolder: resolve(__dirname, "migrations") });

  // 3. Indexes that need raw SQL (GIN on tsvector, pg_trgm GIN, HNSW on vector).
  const indexSql = readFileSync(resolve(__dirname, "indexes.sql"), "utf8");
  await sql.unsafe(indexSql);

  await sql.end();
  console.log("migrate: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
