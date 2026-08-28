CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE SCHEMA "app";
--> statement-breakpoint
CREATE TABLE "app"."wallets" (
	"user_id" varchar NOT NULL,
	"network" varchar NOT NULL,
	"address" varchar NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "wallets_user_id_network_pk" PRIMARY KEY("user_id","network"),
	CONSTRAINT "wallets_address_unique" UNIQUE("address")
);
