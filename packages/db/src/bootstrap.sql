-- Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE EXTENSION IF NOT EXISTS vector;

-- German FTS config that strips diacritics so "broetli" matches "brötli".
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_ts_config WHERE cfgname = 'german_unaccent'
  ) THEN
    CREATE TEXT SEARCH CONFIGURATION german_unaccent (COPY = german);
    ALTER TEXT SEARCH CONFIGURATION german_unaccent
      ALTER MAPPING FOR hword, hword_part, word
      WITH unaccent, german_stem;
  END IF;
END $$;

-- Trigger to keep ingredients.name_tsv in sync with canonical_name_de.
CREATE OR REPLACE FUNCTION ingredients_name_tsv_update() RETURNS trigger AS $$
BEGIN
  NEW.name_tsv := to_tsvector('german_unaccent', coalesce(NEW.canonical_name_de, ''));
  RETURN NEW;
END $$ LANGUAGE plpgsql;
