ALTER TABLE "jobs" ADD COLUMN "agent_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "batch_key" text;