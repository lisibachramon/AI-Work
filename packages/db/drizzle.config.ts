import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./src/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://kitchen:kitchen@localhost:5432/kitchen",
  },
  casing: "snake_case",
  strict: true,
  verbose: true,
});
