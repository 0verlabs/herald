CREATE TABLE "app"."agents" (
	"id" varchar PRIMARY KEY NOT NULL,
	"chain" varchar NOT NULL,
	"agent_id" bigint NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"image" text DEFAULT '' NOT NULL,
	"category" varchar DEFAULT '' NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"feedback_counts" integer DEFAULT 0 NOT NULL,
	"wallet" varchar DEFAULT '' NOT NULL,
	"owner" varchar NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "agents_chain_agent_id_unique" UNIQUE("chain","agent_id"),
	CONSTRAINT "agents_score_range" CHECK ("app"."agents"."score" >= 0 and "app"."agents"."score" <= 100),
	CONSTRAINT "agents_feedback_counts_nonnegative" CHECK ("app"."agents"."feedback_counts" >= 0)
);
--> statement-breakpoint
CREATE INDEX "agents_chain_idx" ON "app"."agents" USING btree ("chain");--> statement-breakpoint
CREATE INDEX "agents_category_idx" ON "app"."agents" USING btree ("chain","category");--> statement-breakpoint
CREATE INDEX "agents_chain_score_idx" ON "app"."agents" USING btree ("chain","score" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "agents_name_trgm_idx" ON "app"."agents" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "agents_description_trgm_idx" ON "app"."agents" USING gin ("description" gin_trgm_ops);