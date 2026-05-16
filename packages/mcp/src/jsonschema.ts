// Local Zod → JSON Schema for MCP tool definitions. Same subset as the one
// in @kitchen/api; duplicated to avoid the MCP package depending on the API.

import type { ZodTypeAny } from "zod";

export function zodToJsonSchemaForMcp(schema: ZodTypeAny): Record<string, unknown> {
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
      const inner = (def as unknown as { type: ZodTypeAny }).type;
      return { type: "array", items: zodToJsonSchemaForMcp(inner) };
    }
    case "ZodObject": {
      const shape = (schema as unknown as { shape: Record<string, ZodTypeAny> }).shape;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [k, v] of Object.entries(shape)) {
        properties[k] = zodToJsonSchemaForMcp(v);
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
      const inner = (def as unknown as { innerType: ZodTypeAny }).innerType;
      return zodToJsonSchemaForMcp(inner);
    }
    default:
      return {};
  }
}
