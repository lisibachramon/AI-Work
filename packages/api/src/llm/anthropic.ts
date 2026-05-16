import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "../env.js";
import type { CompleteArgs, CompleteResult } from "./router.js";
import { zodToJsonSchema } from "./ollama.js";

export class AnthropicClient {
  private readonly client: Anthropic;

  constructor(private readonly env: Env) {
    this.client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }

  private modelFor(task: CompleteArgs<unknown>["task"]): string {
    switch (task) {
      case "photo_vision":
      case "video_vision":
        return this.env.ANTHROPIC_VISION_MODEL;
      case "recipe_generation":
        return this.env.ANTHROPIC_RECIPE_MODEL;
      case "meal_plan":
        return this.env.ANTHROPIC_PLAN_MODEL;
      default:
        return this.env.ANTHROPIC_FALLBACK_MODEL;
    }
  }

  async complete<T>(args: CompleteArgs<T>): Promise<CompleteResult<T>> {
    const model = this.modelFor(args.task);
    const schema = zodToJsonSchema(args.schema);

    const content: Anthropic.Messages.ContentBlockParam[] = [];
    if (args.images) {
      for (const img of args.images) {
        content.push({
          type: "image",
          source: { type: "base64", media_type: img.media_type, data: img.data_base64 },
        });
      }
    }
    content.push({ type: "text", text: args.prompt });

    // Use tool use to force structured output matching the Zod schema.
    const tool: Anthropic.Messages.Tool = {
      name: "emit",
      description: "Emit the structured result.",
      input_schema: schema as Anthropic.Messages.Tool.InputSchema,
    };

    const resp = await this.client.messages.create({
      model,
      max_tokens: args.maxTokens ?? 2048,
      temperature: args.temperature ?? 0.2,
      system: args.system,
      tools: [tool],
      tool_choice: { type: "tool", name: "emit" },
      messages: [{ role: "user", content }],
    });

    const toolBlock = resp.content.find(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
    );
    if (!toolBlock) {
      throw new Error("Anthropic returned no tool_use block");
    }
    const parsed = args.schema.safeParse(toolBlock.input);
    if (!parsed.success) {
      throw new Error(`Anthropic output failed schema: ${parsed.error.message}`);
    }
    return {
      value: parsed.data,
      provider: "anthropic",
      model,
      usage: {
        input_tokens: resp.usage.input_tokens,
        output_tokens: resp.usage.output_tokens,
      },
    };
  }
}
