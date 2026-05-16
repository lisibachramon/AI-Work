import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import * as argon2 from "argon2";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Env } from "../env.js";
import { sessions, userPreferences, users } from "@kitchen/db/schema";

const SESSION_COOKIE = "kitchen_session";
const SESSION_TTL_DAYS = 30;

const Credentials = z.object({
  email: z.string().email(),
  password: z.string().min(10).max(200),
});

function newSessionId(): string {
  return randomBytes(32).toString("hex");
}

async function loadSession(app: FastifyInstance, req: FastifyRequest): Promise<string | null> {
  const sid = req.cookies[SESSION_COOKIE];
  if (!sid) return null;
  const [row] = await app.db.select().from(sessions).where(eq(sessions.id, sid)).limit(1);
  if (!row) return null;
  if (row.expires_at < new Date()) {
    await app.db.delete(sessions).where(eq(sessions.id, sid));
    return null;
  }
  return row.user_id;
}

function setSessionCookie(reply: FastifyReply, sid: string) {
  reply.setCookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
    signed: false,
  });
}

export async function registerAuthRoutes(app: FastifyInstance, _env: Env) {
  // Attach userId on every request (null when unauthenticated).
  app.addHook("preHandler", async (req) => {
    req.userId = await loadSession(app, req);
  });

  app.post("/auth/register", async (req, reply) => {
    const parsed = Credentials.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(parsed.error.flatten());

    const { email, password } = parsed.data;
    const [existing] = await app.db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing) return reply.code(409).send({ error: "email_taken" });

    const password_hash = await argon2.hash(password);
    const [user] = await app.db
      .insert(users)
      .values({ email, password_hash })
      .returning();
    if (!user) return reply.code(500).send({ error: "user_create_failed" });

    await app.db.insert(userPreferences).values({ user_id: user.id }).onConflictDoNothing();

    const sid = newSessionId();
    const expires_at = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
    await app.db.insert(sessions).values({ id: sid, user_id: user.id, expires_at });
    setSessionCookie(reply, sid);
    return { id: user.id, email: user.email };
  });

  app.post("/auth/login", async (req, reply) => {
    const parsed = Credentials.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(parsed.error.flatten());

    const { email, password } = parsed.data;
    const [user] = await app.db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user) return reply.code(401).send({ error: "invalid_credentials" });

    const ok = await argon2.verify(user.password_hash, password);
    if (!ok) return reply.code(401).send({ error: "invalid_credentials" });

    const sid = newSessionId();
    const expires_at = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
    await app.db.insert(sessions).values({ id: sid, user_id: user.id, expires_at });
    setSessionCookie(reply, sid);
    return { id: user.id, email: user.email };
  });

  app.post("/auth/logout", async (req, reply) => {
    const sid = req.cookies[SESSION_COOKIE];
    if (sid) await app.db.delete(sessions).where(eq(sessions.id, sid));
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/auth/me", async (req, reply) => {
    if (!req.userId) return reply.code(401).send({ error: "unauthenticated" });
    const [user] = await app.db.select().from(users).where(eq(users.id, req.userId)).limit(1);
    return { id: user?.id, email: user?.email, display_name: user?.display_name };
  });
}

// Guard helper for other routes.
export function requireAuth(req: FastifyRequest, reply: FastifyReply): string | null {
  if (!req.userId) {
    reply.code(401).send({ error: "unauthenticated" });
    return null;
  }
  return req.userId;
}
