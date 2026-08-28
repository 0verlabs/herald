ALTER TABLE "app"."agents" RENAME COLUMN "agent_id" TO "onchain_id";--> statement-breakpoint
ALTER TABLE "app"."agents" DROP CONSTRAINT "agents_chain_agent_id_unique";--> statement-breakpoint
ALTER TABLE "app"."agents" ADD CONSTRAINT "agents_chain_onchain_id_unique" UNIQUE("chain","onchain_id");