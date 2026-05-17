import type { FastifyInstance } from "fastify";
import { and, desc, eq, isNull } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { mcpTokens } from "@kitchen/db/schema";
import { requireAuth } from "./auth.js";

// MCP HTTP-transport tokens. Stored as sha-256 hashes so the plaintext
// can't be recovered from the DB. The plaintext is shown exactly once,
// at creation time.

const CreateBody = z.object({
  name: z.string().min(1).max(60),
});

function hashToken(plain: string): string {
  return createHash("sha256").update(plain).digest("hex");
}

export function tokenLookup(): { hashToken: typeof hashToken } {
  return { hashToken };
}

export async function registerMcpTokenRoutes(app: FastifyInstance) {
  app.get("/api/mcp-tokens", async (req, reply) => {
    const userId = requireAuth(req, reply);
    if (!userId) return;
    return app.db
      .select({
        id: mcpTokens.id,
        name: mcpTokens.name,
        last_used_at: mcpTokens.last_used_at,
        revoked_at: mcpTokens.revoked_at,
        created_at: mcpTokens.created_at,
      })
      .from(mcpTokens)
      .where(eq(mcpTokens.user_id, userId))
      .orderBy(desc(mcpTokens.created_at));
  });

  app.post("/api/mcp-tokens", async (req, reply) => {
    const userId = requireAuth(req, reply);
    if (!userId) return;
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(parsed.error.flatten());

    // 32 random bytes → 64 hex chars, prefixed for easy recognition
    // (similar to how GitHub PATs ship with a stable prefix).
    const plain = "kmcp_" + randomBytes(32).toString("hex");
    const hashed_token = hashToken(plain);

    const [row] = await app.db
      .insert(mcpTokens)
      .values({
        user_id: userId,
        name: parsed.data.name,
        hashed_token,
      })
      .returning({
        id: mcpTokens.id,
        name: mcpTokens.name,
        created_at: mcpTokens.created_at,
      });

    if (!row) return reply.code(500).send({ error: "token_create_failed" });

    // The plaintext is returned exactly once — the user must copy it now.
    return { ...row, token: plain };
  });

  app.delete("/api/mcp-tokens/:id", async (req, reply) => {
    const userId = requireAuth(req, reply);
    if (!userId) return;
    const { id } = req.params as { id: string };
    const [row] = await app.db
      .update(mcpTokens)
      .set({ revoked_at: new Date() })
      .where(
        and(
          eq(mcpTokens.id, id),
          eq(mcpTokens.user_id, userId),
          isNull(mcpTokens.revoked_at),
        ),
      )
      .returning({ id: mcpTokens.id });
    if (!row) return reply.code(404).send({ error: "not_found" });
    return { ok: true };
  });
}
