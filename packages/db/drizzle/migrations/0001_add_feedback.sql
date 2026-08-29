CREATE TABLE "agent_feedback" (
	"id" varchar PRIMARY KEY NOT NULL,
	"agent_id" varchar NOT NULL,
	"client_address" varchar NOT NULL,
	"feedback_index" bigint NOT NULL,
	"value" double precision NOT NULL,
	"reasoning" text,
	"proof_of_payment" jsonb,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "agent_feedback_agent_client_index_unique" UNIQUE("agent_id","client_address","feedback_index")
);
--> statement-breakpoint
ALTER TABLE "agent_feedback" ADD CONSTRAINT "agent_feedback_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
