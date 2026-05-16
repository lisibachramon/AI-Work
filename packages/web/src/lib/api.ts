// Small fetch wrapper. All requests are same-origin in prod (the web's
// nginx proxies /api, /auth, /health to the api container), so cookies
// flow without ceremony. In dev the Vite proxy does the same.

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "include",
    ...init,
  });
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const msg =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : `http ${res.status}`;
    throw new ApiError(res.status, data, msg);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};

// ----- API types -----

export type Me = { id: string; email: string; display_name: string | null };

export type Location = {
  id: string;
  user_id: string;
  name: string;
  kind: "pantry" | "fridge" | "freezer" | "spice_rack" | "other";
  display_order: number;
};

export type IngredientMatch = {
  ingredient_id: string;
  canonical_name_de: string;
  score: number;
  matched_via: "canonical" | "alias" | "trigram" | "tsv" | "embedding";
};

export type StorageUnit = "g" | "ml" | "piece" | "bunch" | "pack" | "slice";

export type StockItem = {
  id: string;
  quantity: string;
  unit: StorageUnit;
  expiry_date: string | null;
  opened_at: string | null;
  confidence: string;
  source: string;
  ingredient: {
    id: string;
    canonical_name_de: string;
    category: string;
  };
  location: {
    id: string;
    name: string;
    kind: Location["kind"];
  };
};

export type Barcode = {
  gtin: string;
  ingredient_id: string | null;
  brand: string | null;
  product_name: string | null;
  package_quantity: string | null;
  package_unit: StorageUnit | null;
  source: "openfoodfacts" | "manual" | "llm_guess";
  fetched_at: string;
};
