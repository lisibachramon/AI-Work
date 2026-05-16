import { z, type ZodSchema } from "zod";
import type { Env } from "../env.js";
import type { CompleteArgs, CompleteResult } from "./router.js";

// Ollama's /api/chat returns JSON when `format` is set to a JSON schema.
// We hand it the schema derived from the caller's Zod definition.

export class OllamaClient {
  constructor(private readonly env: Env) {}

  private modelFor(task: CompleteArgs<unknown>["task"]): string {
    if (task === "photo_vision" || task === "video_vision") return this.env.OLLAMA_VISION_MODEL;
    return this.env.OLLAMA_TEXT_MODEL;
  }

  async complete<T>(args: CompleteArgs<T>): Promise<CompleteResult<T>> {
    const model = this.modelFor(args.task);
    const url = `${this.env.OLLAMA_BASE_URL}/api/chat`;

    const messages: Array<Record<string, unknown>> = [
      { role: "system", content: args.system },
      args.images && args.images.length > 0
        ? {
            role: "user",
            content: args.prompt,
            images: args.images.map((img) => img.data_base64),
          }
        : { role: "user", content: args.prompt },
    ];

    const body = {
      model,
      messages,
      stream: false,
      format: zodToJsonSchema(args.schema),
      options: {
        temperature: args.temperature ?? 0.2,
        num_predict: args.maxTokens ?? 2048,
      },
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Ollama ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as { message: { content: string } };
    const raw = data.message?.content ?? "";
    const parsed = args.schema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new Error(`Ollama output failed schema: ${parsed.error.message}\n${raw}`);
    }
    return { value: parsed.data, provider: "ollama", model };
  }

  async embed(texts: string[]): Promise<{ vectors: number[][]; provider: "ollama"; model: string }> {
    const model = this.env.OLLAMA_EMBED_MODEL;
    const url = `${this.env.OLLAMA_BASE_URL}/api/embed`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, input: texts }),
    });
    if (!res.ok) throw new Error(`Ollama embed ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { embeddings: number[][] };
    return { vectors: data.embeddings, provider: "ollama", model };
  }
}

// Minimal Zod → JSON Schema. Drizzle/Ollama only needs structural JSON Schema;
// we cover the subset our schemas actually use.
export function zodToJsonSchema(schema: ZodSchema<unknown>): Record<string, unknown> {
  const def = (schema as unknown as { _def: { typeName: string } })._def;
  const t = def.typeName;
  switch (t) {
    case "ZodString":
      return { type: "string" };
    case "ZodNumber":
      return { type: "number" };
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodNull":
      return { type: "null" };
    case "ZodArray": {
      const inner = (def as unknown as { type: ZodSchema<unknown> }).type;
      return { type: "array", items: zodToJsonSchema(inner) };
    }
    case "ZodObject": {
      const shape = (schema as unknown as { shape: Record<string, ZodSchema<unknown>> }).shape;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [k, v] of Object.entries(shape)) {
        properties[k] = zodToJsonSchema(v);
        const innerDef = (v as unknown as { _def: { typeName: string } })._def;
        if (innerDef.typeName !== "ZodOptional" && innerDef.typeName !== "ZodDefault") {
          required.push(k);
        }
      }
      return { type: "object", properties, required, additionalProperties: false };
    }
    case "ZodEnum": {
      const values = (def as unknown as { values: string[] }).values;
      return { type: "string", enum: values };
    }
    case "ZodOptional":
    case "ZodNullable":
    case "ZodDefault": {
      const inner = (def as unknown as { innerType: ZodSchema<unknown> }).innerType;
      return zodToJsonSchema(inner);
    }
    case "ZodUnion": {
      const options = (def as unknown as { options: ZodSchema<unknown>[] }).options;
      return { anyOf: options.map(zodToJsonSchema) };
    }
    default:
      // Fall back to permissive object for unknown types.
      return {};
  }
}

// re-export for tests
export const __test = { zodToJsonSchema };
export type _Z = z.ZodTypeAny;
