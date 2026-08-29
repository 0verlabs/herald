CREATE TABLE "app"."agent_api_services" (
	"id" varchar PRIMARY KEY NOT NULL,
	"agent_id" varchar NOT NULL,
	"name" text NOT NULL,
	"method" varchar NOT NULL,
	"endpoint" text NOT NULL,
	"version" varchar NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."agent_job_services" (
	"id" varchar PRIMARY KEY NOT NULL,
	"agent_id" varchar NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."agent_mcp_services" (
	"id" varchar PRIMARY KEY NOT NULL,
	"agent_id" varchar NOT NULL,
	"endpoint" text NOT NULL,
	"version" varchar NOT NULL,
	"tools" varchar[] DEFAULT '{}',
	"resources" varchar[] DEFAULT '{}',
	"prompts" varchar[] DEFAULT '{}'
);
--> statement-breakpoint
ALTER TABLE "app"."agent_api_services" ADD CONSTRAINT "agent_api_services_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "app"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."agent_job_services" ADD CONSTRAINT "agent_job_services_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "app"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."agent_mcp_services" ADD CONSTRAINT "agent_mcp_services_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "app"."agents"("id") ON DELETE cascade ON UPDATE no action;