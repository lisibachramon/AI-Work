import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";

export async function registerHealthRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ ok: true }));

  app.get("/health/db", async () => {
    await app.db.execute(sql`select 1`);
    return { ok: true };
  });

  app.get("/health/ollama", async () => {
    const url = `${process.env.OLLAMA_BASE_URL ?? "http://host.docker.internal:11434"}/api/tags`;
    const res = await fetch(url);
    if (!res.ok) return { ok: false, status: res.status };
    const data = (await res.json()) as { models: Array<{ name: string }> };
    return { ok: true, models: data.models.map((m) => m.name) };
  });
}
