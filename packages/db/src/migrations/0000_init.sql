CREATE TYPE "public"."barcode_source" AS ENUM('openfoodfacts', 'manual', 'llm_guess');--> statement-breakpoint
CREATE TYPE "public"."consumption_reason" AS ENUM('cooked', 'expired', 'discarded', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."diet" AS ENUM('omnivore', 'vegetarian', 'vegan', 'pescatarian', 'other');--> statement-breakpoint
CREATE TYPE "public"."ingestion_event_kind" AS ENUM('voice', 'photo', 'video_frame', 'barcode', 'manual');--> statement-breakpoint
CREATE TYPE "public"."ingestion_event_status" AS ENUM('pending', 'parsed', 'applied', 'failed', 'needs_review');--> statement-breakpoint
CREATE TYPE "public"."ingredient_category" AS ENUM('produce', 'dairy', 'meat', 'fish', 'bakery', 'dry_goods', 'spices', 'beverages', 'frozen', 'condiments', 'other');--> statement-breakpoint
CREATE TYPE "public"."location_kind" AS ENUM('pantry', 'fridge', 'freezer', 'spice_rack', 'other');--> statement-breakpoint
CREATE TYPE "public"."recipe_effort" AS ENUM('quick', 'medium', 'involved');--> statement-breakpoint
CREATE TYPE "public"."recipe_health" AS ENUM('light', 'balanced', 'hearty', 'indulgent');--> statement-breakpoint
CREATE TYPE "public"."recipe_source" AS ENUM('ai', 'user', 'imported');--> statement-breakpoint
CREATE TYPE "public"."stock_source" AS ENUM('voice', 'photo', 'manual', 'barcode', 'video_barcode', 'video_vision');--> statement-breakpoint
CREATE TYPE "public"."storage_unit" AS ENUM('g', 'ml', 'piece', 'bunch', 'pack', 'slice');--> statement-breakpoint
CREATE TABLE "barcodes" (
	"gtin" text PRIMARY KEY NOT NULL,
	"ingredient_id" uuid,
	"brand" text,
	"product_name" text,
	"package_quantity" numeric(10, 3),
	"package_unit" "storage_unit",
	"off_payload" jsonb,
	"source" "barcode_source" NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consumption_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"stock_item_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"quantity_consumed" numeric(12, 3) NOT NULL,
	"unit" "storage_unit" NOT NULL,
	"reason" "consumption_reason" DEFAULT 'cooked' NOT NULL,
	"recipe_id" uuid,
	"notes" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "essentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"present" boolean DEFAULT true NOT NULL,
	"low" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "ingestion_event_kind" NOT NULL,
	"status" "ingestion_event_status" DEFAULT 'pending' NOT NULL,
	"input_blob_path" text,
	"transcript" text,
	"llm_response" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ingestion_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"proposed_action" jsonb NOT NULL,
	"chosen" boolean,
	"applied_stock_item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingredient_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"lang" text DEFAULT 'de-CH' NOT NULL,
	"source" text DEFAULT 'user' NOT NULL,
	"confidence" numeric(4, 3) DEFAULT '1.000' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"canonical_name_de" text NOT NULL,
	"canonical_name_en" text,
	"category" "ingredient_category" NOT NULL,
	"default_unit" "storage_unit" NOT NULL,
	"density_g_per_ml" numeric(8, 4),
	"typical_piece_weight_g" numeric(10, 2),
	"shelf_life_days" integer,
	"embedding" vector(1024),
	"name_tsv" "tsvector",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "location_kind" NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"hashed_token" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" uuid NOT NULL,
	"ingredient_id" uuid,
	"raw_text" text NOT NULL,
	"quantity" numeric(12, 3),
	"unit" "storage_unit",
	"optional" boolean DEFAULT false NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"instructions_md" text NOT NULL,
	"effort" "recipe_effort" NOT NULL,
	"time_minutes" integer NOT NULL,
	"healthiness" "recipe_health" NOT NULL,
	"cuisine" text,
	"servings" integer DEFAULT 2 NOT NULL,
	"source" "recipe_source" DEFAULT 'ai' NOT NULL,
	"source_url" text,
	"embedding" vector(1024),
	"times_cooked" integer DEFAULT 0 NOT NULL,
	"last_cooked_at" timestamp with time zone,
	"rating" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"unit" "storage_unit" NOT NULL,
	"original_quantity" numeric(12, 3),
	"barcode" text,
	"purchased_at" date,
	"expiry_date" date,
	"opened_at" timestamp with time zone,
	"notes" text,
	"confidence" numeric(4, 3) DEFAULT '1.000' NOT NULL,
	"source" "stock_source" NOT NULL,
	"source_event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"diet" "diet" DEFAULT 'omnivore' NOT NULL,
	"dislikes" text[] DEFAULT '{}'::text[] NOT NULL,
	"allergies" text[] DEFAULT '{}'::text[] NOT NULL,
	"household_size" integer DEFAULT 1 NOT NULL,
	"weekly_budget_chf" numeric(10, 2),
	"preferred_cuisines" text[] DEFAULT '{}'::text[] NOT NULL,
	"default_locale" text DEFAULT 'de-CH' NOT NULL,
	"retain_audio" boolean DEFAULT true NOT NULL,
	"retain_sample_photo_per_item" boolean DEFAULT true NOT NULL,
	"retain_video_frames" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "webauthn_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"public_key" text NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	"device_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "barcodes" ADD CONSTRAINT "barcodes_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumption_events" ADD CONSTRAINT "consumption_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumption_events" ADD CONSTRAINT "consumption_events_stock_item_id_stock_items_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumption_events" ADD CONSTRAINT "consumption_events_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "essentials" ADD CONSTRAINT "essentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "essentials" ADD CONSTRAINT "essentials_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_events" ADD CONSTRAINT "ingestion_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_proposals" ADD CONSTRAINT "ingestion_proposals_event_id_ingestion_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."ingestion_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_proposals" ADD CONSTRAINT "ingestion_proposals_applied_stock_item_id_stock_items_id_fk" FOREIGN KEY ("applied_stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredient_aliases" ADD CONSTRAINT "ingredient_aliases_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tokens" ADD CONSTRAINT "mcp_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_barcode_barcodes_gtin_fk" FOREIGN KEY ("barcode") REFERENCES "public"."barcodes"("gtin") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consumption_user_ingredient_occurred_idx" ON "consumption_events" USING btree ("user_id","ingredient_id","occurred_at");--> statement-breakpoint
CREATE INDEX "consumption_stock_idx" ON "consumption_events" USING btree ("stock_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "essentials_user_ingredient_idx" ON "essentials" USING btree ("user_id","ingredient_id");--> statement-breakpoint
CREATE INDEX "ingestion_events_user_status_idx" ON "ingestion_events" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "ingestion_proposals_event_idx" ON "ingestion_proposals" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ingredient_aliases_unique_idx" ON "ingredient_aliases" USING btree ("ingredient_id","alias","lang");--> statement-breakpoint
CREATE INDEX "ingredient_aliases_alias_idx" ON "ingredient_aliases" USING btree ("alias");--> statement-breakpoint
CREATE INDEX "ingredients_user_id_idx" ON "ingredients" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ingredients_user_canonical_idx" ON "ingredients" USING btree ("user_id","canonical_name_de");--> statement-breakpoint
CREATE INDEX "locations_user_id_idx" ON "locations" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "locations_user_name_idx" ON "locations" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "mcp_tokens_user_id_idx" ON "mcp_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_tokens_hashed_token_idx" ON "mcp_tokens" USING btree ("hashed_token");--> statement-breakpoint
CREATE INDEX "recipe_ingredients_recipe_idx" ON "recipe_ingredients" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX "recipes_user_idx" ON "recipes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "stock_items_user_ingredient_location_idx" ON "stock_items" USING btree ("user_id","ingredient_id","location_id");--> statement-breakpoint
CREATE INDEX "stock_items_user_expiry_idx" ON "stock_items" USING btree ("user_id","expiry_date");--> statement-breakpoint
CREATE INDEX "stock_items_source_event_idx" ON "stock_items" USING btree ("source_event_id");