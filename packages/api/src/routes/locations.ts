import type { FastifyInstance } from "fastify";
import { and, asc, eq } from "drizzle-orm";
import { LocationInput } from "@kitchen/shared/schemas";
import { locations } from "@kitchen/db/schema";
import { requireAuth } from "./auth.js";

export async function registerLocationRoutes(app: FastifyInstance) {
  app.get("/api/locations", async (req, reply) => {
    const userId = requireAuth(req, reply);
    if (!userId) return;
    return app.db
      .select()
      .from(locations)
      .where(eq(locations.user_id, userId))
      .orderBy(asc(locations.display_order));
  });

  app.post("/api/locations", async (req, reply) => {
    const userId = requireAuth(req, reply);
    if (!userId) return;
    const parsed = LocationInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
    const [row] = await app.db
      .insert(locations)
      .values({ user_id: userId, ...parsed.data })
      .returning();
    return row;
  });

  app.delete("/api/locations/:id", async (req, reply) => {
    const userId = requireAuth(req, reply);
    if (!userId) return;
    const { id } = req.params as { id: string };
    await app.db
      .delete(locations)
      .where(and(eq(locations.id, id), eq(locations.user_id, userId)));
    return { ok: true };
  });
}
