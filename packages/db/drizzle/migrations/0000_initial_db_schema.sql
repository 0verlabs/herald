CREATE TABLE "agents" (
	"id" varchar PRIMARY KEY NOT NULL,
	"chain" varchar NOT NULL,
	"onchain_agent_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"image" text,
	"tags" varchar[] DEFAULT '{}',
	"score" integer DEFAULT 0,
	"feedback_counts" integer DEFAULT 0,
	"wallet" varchar,
	"owner" varchar NOT NULL
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
CREATE INDEX "agents_chain_idx" ON "agents" USING btree ("chain");--> statement-breakpoint
CREATE INDEX "agents_onchain_agent_id_idx" ON "agents" USING btree ("onchain_agent_id");