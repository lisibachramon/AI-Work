ALTER TABLE "ingestion_events" ADD COLUMN "client_session_id" text;--> statement-breakpoint
ALTER TABLE "ingestion_events" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ingestion_events_user_session_uq" ON "ingestion_events" USING btree ("user_id","client_session_id") WHERE "ingestion_events"."client_session_id" IS NOT NULL;