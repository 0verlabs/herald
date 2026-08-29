CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION immutable_array_to_string(text[], text)
RETURNS text AS $$
    SELECT array_to_string($1, $2);
$$ LANGUAGE sql IMMUTABLE STRICT;

CREATE TABLE "agent_api_services" (
	"id" varchar PRIMARY KEY NOT NULL,
	"agent_id" varchar NOT NULL,
	"name" text NOT NULL,
	"method" varchar NOT NULL,
	"endpoint" text NOT NULL,
	"version" varchar NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_job_services" (
	"id" varchar PRIMARY KEY NOT NULL,
	"agent_id" varchar NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_mcp_services" (
	"id" varchar PRIMARY KEY NOT NULL,
	"agent_id" varchar NOT NULL,
	"endpoint" text NOT NULL,
	"version" varchar NOT NULL,
	"tools" varchar[] DEFAULT '{}',
	"resources" varchar[] DEFAULT '{}',
	"prompts" varchar[] DEFAULT '{}'
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" varchar PRIMARY KEY NOT NULL,
	"chain" varchar NOT NULL,
	"onchain_id" bigint NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"image" text NOT NULL,
	"category" varchar,
	"score" integer DEFAULT 0 NOT NULL,
	"feedback_counts" integer DEFAULT 0 NOT NULL,
	"wallet" varchar,
	"owner" varchar NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "agents_chain_onchain_id_unique" UNIQUE("chain","onchain_id"),
	CONSTRAINT "agents_score_range" CHECK ("agents"."score" >= 0 and "agents"."score" <= 100),
	CONSTRAINT "agents_feedback_counts_nonnegative" CHECK ("agents"."feedback_counts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"user_id" varchar NOT NULL,
	"network" varchar NOT NULL,
	"address" varchar NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "wallets_user_id_network_pk" PRIMARY KEY("user_id","network"),
	CONSTRAINT "wallets_address_unique" UNIQUE("address")
);
--> statement-breakpoint
ALTER TABLE "agent_api_services" ADD CONSTRAINT "agent_api_services_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_job_services" ADD CONSTRAINT "agent_job_services_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_mcp_services" ADD CONSTRAINT "agent_mcp_services_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_api_services_agent_id_idx" ON "agent_api_services" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_api_services_name_trgm_idx" ON "agent_api_services" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "agent_api_services_method_trgm_idx" ON "agent_api_services" USING gin ("method" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "agent_api_services_description_trgm_idx" ON "agent_api_services" USING gin ("description" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "agent_job_services_agent_id_idx" ON "agent_job_services" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_job_services_title_trgm_idx" ON "agent_job_services" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "agent_job_services_description_trgm_idx" ON "agent_job_services" USING gin ("description" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "agent_mcp_services_agent_id_idx" ON "agent_mcp_services" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_mcp_services_tools_trgm_idx" ON "agent_mcp_services" USING gin (immutable_array_to_string("tools", ' ') gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "agent_mcp_services_resources_trgm_idx" ON "agent_mcp_services" USING gin (immutable_array_to_string("resources", ' ') gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "agent_mcp_services_prompts_trgm_idx" ON "agent_mcp_services" USING gin (immutable_array_to_string("prompts", ' ') gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "agents_chain_idx" ON "agents" USING btree ("chain");--> statement-breakpoint
CREATE INDEX "agents_category_idx" ON "agents" USING btree ("chain","category");--> statement-breakpoint
CREATE INDEX "agents_chain_score_idx" ON "agents" USING btree ("chain","score" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "agents_name_trgm_idx" ON "agents" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "agents_description_trgm_idx" ON "agents" USING gin ("description" gin_trgm_ops);
