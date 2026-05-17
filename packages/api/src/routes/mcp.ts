// MCP HTTP transport. Single endpoint POST /mcp accepting JSON-RPC 2.0
// per the MCP spec, authenticated via Bearer token in the Authorization
// header. We don't use the SDK's StreamableHTTPServerTransport because
// our tools are all sub-50ms reads — plain JSON responses are sufficient
// and avoid the SSE/session-management overhead.
//
// Methods supported:
//   - initialize        — handshake; returns capabilities + serverInfo
//   - notifications/*   — accept and ignore (notifications have no id)
//   - tools/list        — enumerate the tools array
//   - tools/call        — dispatch to the handler bound to the authed user
//
// Token auth: SHA-256 hash of the plaintext bearer is looked up in
// `mcp_tokens`. Tokens with `revoked_at` set are rejected; valid tokens
// have their `last_used_at` bumped on each call.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import { createHash } from "node:crypto";
import { TOOLS } from "@kitchen/mcp/tools";
import { zodToJsonSchemaForMcp } from "@kitchen/mcp/jsonschema";
import { mcpTokens } from "@kitchen/db/schema";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function hashToken(plain: string): string {
  return createHash("sha256").update(plain).digest("hex");
}

async function authenticate(
  app: FastifyInstance,
  req: FastifyRequest,
): Promise<{ user_id: string; token_id: string } | null> {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return null;
  const plain = auth.slice("Bearer ".length).trim();
  if (!plain) return null;
  const hashed = hashToken(plain);
  const [row] = await app.db
    .select({
      id: mcpTokens.id,
      user_id: mcpTokens.user_id,
      revoked_at: mcpTokens.revoked_at,
    })
    .from(mcpTokens)
    .where(and(eq(mcpTokens.hashed_token, hashed), isNull(mcpTokens.revoked_at)))
    .limit(1);
  if (!row) return null;
  // Fire-and-forget last_used_at update so we don't hold up the response.
  app.db
    .update(mcpTokens)
    .set({ last_used_at: new Date() })
    .where(eq(mcpTokens.id, row.id))
    .catch((err) => app.log.warn({ err }, "mcp_token last_used_at update failed"));
  return { user_id: row.user_id, token_id: row.id };
}

function errorResponse(
  id: JsonRpcRequest["id"] | undefined,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}

async function dispatch(
  app: FastifyInstance,
  userId: string,
  req: JsonRpcRequest,
): Promise<JsonRpcResponse | null> {
  // Notifications have no id — accept and skip.
  if (req.id === undefined || req.id === null) {
    if (req.method.startsWith("notifications/")) return null;
    // Even non-notification methods without id can be treated as fire-and-forget.
    return null;
  }

  switch (req.method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id: req.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "kitchen-mcp", version: "0.0.0" },
        },
      };

    case "tools/list":
      return {
        jsonrpc: "2.0",
        id: req.id,
        result: {
          tools: TOOLS.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: zodToJsonSchemaForMcp(t.inputSchema),
          })),
        },
      };

    case "tools/call": {
      const params = (req.params as { name?: string; arguments?: unknown }) ?? {};
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) {
        return errorResponse(req.id, -32602, `unknown tool: ${params.name}`);
      }
      try {
        const value = await tool.handler(app.db, userId, params.arguments ?? {});
        return {
          jsonrpc: "2.0",
          id: req.id,
          result: {
            content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
          },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          jsonrpc: "2.0",
          id: req.id,
          result: { content: [{ type: "text", text: `error: ${msg}` }], isError: true },
        };
      }
    }

    case "ping":
      return { jsonrpc: "2.0", id: req.id, result: {} };

    default:
      return errorResponse(req.id, -32601, `method not found: ${req.method}`);
  }
}

export async function registerMcpHttpRoutes(app: FastifyInstance) {
  app.post("/mcp", async (req: FastifyRequest, reply: FastifyReply) => {
    const ctx = await authenticate(app, req);
    if (!ctx) {
      reply.header("WWW-Authenticate", "Bearer realm=kitchen-mcp");
      return reply.code(401).send({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32001, message: "unauthorized" },
      } satisfies JsonRpcResponse);
    }

    // Accept either a single request or a batch.
    const body = req.body as unknown;
    if (Array.isArray(body)) {
      const responses: JsonRpcResponse[] = [];
      for (const r of body) {
        const resp = await dispatch(app, ctx.user_id, r as JsonRpcRequest);
        if (resp) responses.push(resp);
      }
      return responses;
    }
    const resp = await dispatch(app, ctx.user_id, body as JsonRpcRequest);
    if (!resp) return reply.code(202).send();
    return resp;
  });

  // GET is used by the spec for server-initiated server-sent events. We
  // don't push notifications from the server, so reject cleanly so
  // clients fall back to request/response over POST.
  app.get("/mcp", async (_req, reply) => {
    return reply.code(405).send({ error: "method_not_allowed" });
  });
}
