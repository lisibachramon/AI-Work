// Barcode lookup: cache → OpenFoodFacts → LLM guess.
//
// M1: cache + OFF. The LLM-guess fallback is wired but commented behind
// an explicit env flag until M2 lights up the broader ingestion pipeline.

import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { barcodes } from "@kitchen/db/schema";
import { requireAuth } from "./auth.js";

const GTIN_RE = /^[0-9]{8,14}$/;
const CACHE_TTL_DAYS = 30;

function normalizeGtin(g: string): string {
  return g.padStart(13, "0").slice(-13);
}

type OffProduct = {
  product?: {
    product_name?: string;
    brands?: string;
    quantity?: string;
    product_quantity?: string;
    product_quantity_unit?: string;
    image_url?: string;
  };
  status?: number;
};

export async function registerBarcodeRoutes(app: FastifyInstance) {
  app.get("/api/barcode/:gtin", async (req, reply) => {
    const userId = requireAuth(req, reply);
    if (!userId) return;
    const params = z.object({ gtin: z.string().regex(GTIN_RE) }).safeParse(req.params);
    if (!params.success) return reply.code(400).send(params.error.flatten());
    const gtin = normalizeGtin(params.data.gtin);

    const [cached] = await app.db.select().from(barcodes).where(eq(barcodes.gtin, gtin)).limit(1);
    const fresh =
      cached && cached.fetched_at.getTime() > Date.now() - CACHE_TTL_DAYS * 86400 * 1000;
    if (cached && fresh) return cached;

    const off = await fetchOpenFoodFacts(gtin);
    if (off) {
      const [row] = await app.db
        .insert(barcodes)
        .values({
          gtin,
          brand: off.brand,
          product_name: off.product_name,
          package_quantity: off.package_quantity?.toString(),
          package_unit: off.package_unit,
          off_payload: off.raw,
          source: "openfoodfacts",
        })
        .onConflictDoUpdate({
          target: barcodes.gtin,
          set: {
            brand: off.brand,
            product_name: off.product_name,
            package_quantity: off.package_quantity?.toString(),
            package_unit: off.package_unit,
            off_payload: off.raw,
            source: "openfoodfacts",
            fetched_at: new Date(),
          },
        })
        .returning();
      return row;
    }

    return reply.code(404).send({ error: "barcode_unknown", gtin });
  });
}

interface OffResolved {
  brand: string | null;
  product_name: string | null;
  package_quantity: number | null;
  package_unit: "g" | "ml" | "piece" | "bunch" | "pack" | "slice" | null;
  raw: unknown;
}

async function fetchOpenFoodFacts(gtin: string): Promise<OffResolved | null> {
  const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${gtin}.json`, {
    headers: { "user-agent": "kitchen-app/0.1 (self-hosted)" },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as OffProduct;
  if (data.status !== 1 || !data.product) return null;
  const p = data.product;

  let package_quantity: number | null = null;
  let package_unit: OffResolved["package_unit"] = null;
  if (p.product_quantity && p.product_quantity_unit) {
    const n = Number(p.product_quantity);
    if (Number.isFinite(n)) {
      package_quantity = n;
      const u = p.product_quantity_unit.toLowerCase();
      if (u === "g" || u === "kg") {
        package_quantity = u === "kg" ? n * 1000 : n;
        package_unit = "g";
      } else if (u === "ml" || u === "l" || u === "cl") {
        package_quantity = u === "l" ? n * 1000 : u === "cl" ? n * 10 : n;
        package_unit = "ml";
      }
    }
  }

  return {
    brand: p.brands ?? null,
    product_name: p.product_name ?? null,
    package_quantity,
    package_unit,
    raw: data,
  };
}
