import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { loadEnv } from "./env.js";
import { createDb } from "@kitchen/db";
import { LlmRouter } from "./llm/router.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerIngredientRoutes } from "./routes/ingredients.js";
import { registerLocationRoutes } from "./routes/locations.js";
import { registerStockRoutes } from "./routes/stock.js";
import { registerBarcodeRoutes } from "./routes/barcode.js";
import { registerRecipeRoutes } from "./routes/recipes.js";
import { registerIngestRoutes } from "./routes/ingest.js";
import { registerShoppingRoutes } from "./routes/shopping.js";
import { registerEssentialsRoutes } from "./routes/essentials.js";
import { registerEmbeddingsRoutes } from "./routes/embeddings.js";
import { registerMcpTokenRoutes } from "./routes/mcp-tokens.js";
import { registerMcpHttpRoutes } from "./routes/mcp.js";

declare module "fastify" {
  interface FastifyInstance {
    db: ReturnType<typeof createDb>;
    llm: LlmRouter;
  }
  interface FastifyRequest {
    userId: string | null;
  }
}

async function main() {
  const env = loadEnv();
  const db = createDb(env.DATABASE_URL);
  const llm = new LlmRouter(env);

  const app = Fastify({
    logger: {
      level: env.NODE_ENV === "production" ? "info" : "debug",
      transport:
        env.NODE_ENV === "production"
          ? undefined
          : { target: "pino-pretty", options: { translateTime: "SYS:HH:MM:ss" } },
    },
    trustProxy: true,
    bodyLimit: 25 * 1024 * 1024,
  });

  app.decorate("db", db);
  app.decorate("llm", llm);
  app.decorateRequest("userId", null);

  // In production, lock CORS to the configured origin(s). Reflecting the
  // request origin defeats the point of CORS once we're on the public web.
  const allowedOrigins =
    env.NODE_ENV === "production" && env.ALLOWED_ORIGIN
      ? env.ALLOWED_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean)
      : true;
  await app.register(cors, { origin: allowedOrigins, credentials: true });
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });

  await registerHealthRoutes(app);
  await registerAuthRoutes(app, env);
  await registerIngredientRoutes(app);
  await registerLocationRoutes(app);
  await registerStockRoutes(app);
  await registerBarcodeRoutes(app);
  await registerRecipeRoutes(app);
  await registerIngestRoutes(app);
  await registerShoppingRoutes(app);
  await registerEssentialsRoutes(app);
  await registerEmbeddingsRoutes(app);
  await registerMcpTokenRoutes(app);
  await registerMcpHttpRoutes(app);

  await app.listen({ host: "0.0.0.0", port: env.API_PORT });
  app.log.info({ port: env.API_PORT }, "api up");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
