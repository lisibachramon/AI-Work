import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32),
  PUBLIC_BASE_URL: z.string().url().default("https://kitchen.local:8443"),

  OLLAMA_BASE_URL: z.string().url().default("http://host.docker.internal:11434"),
  OLLAMA_TEXT_MODEL: z.string().default("qwen2.5:14b-instruct"),
  OLLAMA_EMBED_MODEL: z.string().default("bge-m3"),
  OLLAMA_VISION_MODEL: z.string().default("qwen2.5vl:7b"),

  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_VISION_MODEL: z.string().default("claude-sonnet-4-6"),
  ANTHROPIC_RECIPE_MODEL: z.string().default("claude-sonnet-4-6"),
  ANTHROPIC_PLAN_MODEL: z.string().default("claude-opus-4-7"),
  ANTHROPIC_FALLBACK_MODEL: z.string().default("claude-haiku-4-5"),

  TASK_TRANSCRIPT_PARSE_PROVIDER: z.enum(["ollama", "anthropic"]).default("ollama"),
  TASK_BARCODE_GUESS_PROVIDER: z.enum(["ollama", "anthropic"]).default("ollama"),
  TASK_AUTOCOMPLETE_PROVIDER: z.enum(["ollama", "anthropic"]).default("ollama"),
  TASK_EMBEDDINGS_PROVIDER: z.enum(["ollama", "anthropic"]).default("ollama"),
  TASK_PHOTO_VISION_PROVIDER: z.enum(["ollama", "anthropic"]).default("anthropic"),
  TASK_VIDEO_VISION_PROVIDER: z.enum(["ollama", "anthropic"]).default("anthropic"),
  TASK_RECIPE_GENERATION_PROVIDER: z.enum(["ollama", "anthropic"]).default("anthropic"),
  TASK_MEAL_PLAN_PROVIDER: z.enum(["ollama", "anthropic"]).default("anthropic"),

  WHISPER_BASE_URL: z.string().url().default("http://whisper:9000"),
  WHISPER_MODEL: z.string().default("large-v3"),
  WHISPER_LANGUAGE: z.string().default("de"),

  VIDEO_MAX_VISION_CALLS_PER_SESSION: z.coerce.number().int().positive().default(30),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}
