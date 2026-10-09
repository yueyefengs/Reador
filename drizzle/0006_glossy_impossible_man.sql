ALTER TABLE "books" ADD COLUMN "structure_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "origin" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "depth" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "archived_source_ids" jsonb;