-- Indexes that can't be declared via Drizzle. All idempotent.

-- Trigger binding (table exists after migrations).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ingredients') THEN
    DROP TRIGGER IF EXISTS ingredients_name_tsv_trg ON ingredients;
    CREATE TRIGGER ingredients_name_tsv_trg
      BEFORE INSERT OR UPDATE OF canonical_name_de ON ingredients
      FOR EACH ROW EXECUTE FUNCTION ingredients_name_tsv_update();
  END IF;
END $$;

-- Full-text search on ingredients.
CREATE INDEX IF NOT EXISTS ingredients_name_tsv_gin
  ON ingredients USING gin (name_tsv);

-- Trigram search on aliases for fuzzy autocomplete.
CREATE INDEX IF NOT EXISTS ingredient_aliases_alias_trgm
  ON ingredient_aliases USING gin (alias gin_trgm_ops);

-- HNSW vector index on ingredients.embedding for semantic search.
-- Built lazily on first non-null insert; safe with IF NOT EXISTS.
CREATE INDEX IF NOT EXISTS ingredients_embedding_hnsw
  ON ingredients USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS recipes_embedding_hnsw
  ON recipes USING hnsw (embedding vector_cosine_ops);

-- Soft-delete-aware index on stock_items expiry.
CREATE INDEX IF NOT EXISTS stock_items_user_expiry_alive_idx
  ON stock_items (user_id, expiry_date)
  WHERE deleted_at IS NULL;
