CREATE TABLE "user_wallets" (
	"user_id" varchar NOT NULL,
	"network" varchar NOT NULL,
	"wallet_address" varchar NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "user_wallets_user_id_network_pk" PRIMARY KEY("user_id","network"),
	CONSTRAINT "user_wallets_wallet_address_unique" UNIQUE("wallet_address")
);
