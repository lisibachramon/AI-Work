import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export type DbClient = ReturnType<typeof createDb>;

export function createDb(connectionString: string) {
  const sql = postgres(connectionString, {
    max: 10,
    idle_timeout: 30,
    prepare: false,
  });
  return drizzle(sql, { schema, casing: "snake_case" });
}

export { schema };
