CREATE TABLE "concept_dependencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"book_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"prerequisite_id" uuid NOT NULL,
	"strength" text NOT NULL,
	"reason" text NOT NULL,
	"citations" jsonb NOT NULL,
	"job_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "concept_origins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"book_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"origin_key" text NOT NULL,
	"concept_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "concepts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"book_id" uuid NOT NULL,
	"identity_key" text NOT NULL,
	"label" text NOT NULL,
	"definition" text NOT NULL,
	"kind" text NOT NULL,
	"anchor_source_id" uuid NOT NULL,
	"citations" jsonb NOT NULL,
	"mastery_criteria" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "concept_id" uuid;--> statement-breakpoint
ALTER TABLE "concept_dependencies" ADD CONSTRAINT "concept_dependencies_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_dependencies" ADD CONSTRAINT "concept_dependencies_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_dependencies" ADD CONSTRAINT "concept_dependencies_prerequisite_id_concepts_id_fk" FOREIGN KEY ("prerequisite_id") REFERENCES "public"."concepts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_dependencies" ADD CONSTRAINT "concept_dependencies_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_origins" ADD CONSTRAINT "concept_origins_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_origins" ADD CONSTRAINT "concept_origins_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_origins" ADD CONSTRAINT "concept_origins_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_anchor_source_id_sources_id_fk" FOREIGN KEY ("anchor_source_id") REFERENCES "public"."sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "concept_dependency_unique" ON "concept_dependencies" USING btree ("concept_id","prerequisite_id");--> statement-breakpoint
CREATE UNIQUE INDEX "concept_origin_unique" ON "concept_origins" USING btree ("job_id","origin_key");--> statement-breakpoint
CREATE UNIQUE INDEX "concept_identity" ON "concepts" USING btree ("owner_id","book_id","identity_key");--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- 知识点、来源、生成任务和题目必须属于同一账号、同一本书。
ALTER TABLE concepts ADD CONSTRAINT concepts_owner_book UNIQUE(id,owner_id,book_id);
--> statement-breakpoint
ALTER TABLE concepts ADD CONSTRAINT concepts_book_owner_fk FOREIGN KEY(book_id,owner_id) REFERENCES books(id,owner_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE concepts ADD CONSTRAINT concepts_anchor_owner_book_fk FOREIGN KEY(anchor_source_id,owner_id,book_id) REFERENCES sources(id,owner_id,book_id);
--> statement-breakpoint
ALTER TABLE concepts ADD CONSTRAINT concepts_kind_check CHECK(kind IN ('conceptual','procedural','representational','language','meta'));
--> statement-breakpoint
ALTER TABLE concept_origins ADD CONSTRAINT origins_concept_owner_book_fk FOREIGN KEY(concept_id,owner_id,book_id) REFERENCES concepts(id,owner_id,book_id);
--> statement-breakpoint
ALTER TABLE concept_origins ADD CONSTRAINT origins_job_owner_book_fk FOREIGN KEY(job_id,owner_id,book_id) REFERENCES jobs(id,owner_id,book_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE concept_dependencies ADD CONSTRAINT dependency_concept_owner_book_fk FOREIGN KEY(concept_id,owner_id,book_id) REFERENCES concepts(id,owner_id,book_id);
--> statement-breakpoint
ALTER TABLE concept_dependencies ADD CONSTRAINT dependency_prerequisite_owner_book_fk FOREIGN KEY(prerequisite_id,owner_id,book_id) REFERENCES concepts(id,owner_id,book_id);
--> statement-breakpoint
ALTER TABLE concept_dependencies ADD CONSTRAINT dependency_job_owner_book_fk FOREIGN KEY(job_id,owner_id,book_id) REFERENCES jobs(id,owner_id,book_id);
--> statement-breakpoint
ALTER TABLE concept_dependencies ADD CONSTRAINT dependency_distinct_check CHECK(concept_id<>prerequisite_id AND strength IN ('hard','soft'));
--> statement-breakpoint
ALTER TABLE questions ADD CONSTRAINT questions_concept_owner_book_fk FOREIGN KEY(concept_id,owner_id,book_id) REFERENCES concepts(id,owner_id,book_id);
--> statement-breakpoint
DROP INDEX question_remedy_unique;
--> statement-breakpoint
CREATE UNIQUE INDEX question_remedy_concept_unique ON questions(remedy_of,COALESCE(concept_id,'00000000-0000-0000-0000-000000000000'::uuid)) WHERE remedy_of IS NOT NULL;
