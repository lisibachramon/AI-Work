// Two-provider abstraction. Per-task config decides who runs the call.
// Every consumer in the codebase imports `llm` from here and never talks
// to a vendor SDK directly.

import { z, type ZodSchema } from "zod";
import type { Env } from "../env.js";
import { OllamaClient } from "./ollama.js";
import { AnthropicClient } from "./anthropic.js";

export type LlmProvider = "ollama" | "anthropic";

export type LlmTask =
  | "transcript_parse"
  | "barcode_guess"
  | "autocomplete"
  | "embeddings"
  | "photo_vision"
  | "video_vision"
  | "recipe_generation"
  | "meal_plan";

export interface CompleteArgs<T> {
  task: LlmTask;
  system: string;
  prompt: string;
  schema: ZodSchema<T>;
  images?: Array<{ media_type: "image/jpeg" | "image/png" | "image/webp"; data_base64: string }>;
  temperature?: number;
  maxTokens?: number;
  fallbackToAnthropicHaiku?: boolean;
}

export interface CompleteResult<T> {
  value: T;
  provider: LlmProvider;
  model: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface EmbedArgs {
  task: "embeddings";
  texts: string[];
}

export interface EmbedResult {
  vectors: number[][];
  provider: LlmProvider;
  model: string;
}

export class LlmRouter {
  private readonly ollama: OllamaClient;
  private readonly anthropic: AnthropicClient | null;
  private readonly providerByTask: Record<LlmTask, LlmProvider>;

  constructor(private readonly env: Env) {
    this.ollama = new OllamaClient(env);
    this.anthropic = env.ANTHROPIC_API_KEY ? new AnthropicClient(env) : null;
    this.providerByTask = {
      transcript_parse: env.TASK_TRANSCRIPT_PARSE_PROVIDER,
      barcode_guess: env.TASK_BARCODE_GUESS_PROVIDER,
      autocomplete: env.TASK_AUTOCOMPLETE_PROVIDER,
      embeddings: env.TASK_EMBEDDINGS_PROVIDER,
      photo_vision: env.TASK_PHOTO_VISION_PROVIDER,
      video_vision: env.TASK_VIDEO_VISION_PROVIDER,
      recipe_generation: env.TASK_RECIPE_GENERATION_PROVIDER,
      meal_plan: env.TASK_MEAL_PLAN_PROVIDER,
    };
  }

  providerFor(task: LlmTask): LlmProvider {
    const configured = this.providerByTask[task];
    // Fall back to ollama if Anthropic isn't configured.
    if (configured === "anthropic" && !this.anthropic) return "ollama";
    return configured;
  }

  async complete<T>(args: CompleteArgs<T>): Promise<CompleteResult<T>> {
    const provider = this.providerFor(args.task);
    if (provider === "anthropic" && this.anthropic) {
      return this.anthropic.complete(args);
    }
    return this.ollama.complete(args);
  }

  async embed(args: EmbedArgs): Promise<EmbedResult> {
    // Embeddings always go to Ollama (bge-m3, multilingual incl. German).
    // Anthropic doesn't expose a first-party embedding endpoint, so this is hard-wired.
    return this.ollama.embed(args.texts);
  }
}

// Convenience: a no-op schema for callers that don't care about parsing.
export const PassthroughString = z.object({ text: z.string() });
