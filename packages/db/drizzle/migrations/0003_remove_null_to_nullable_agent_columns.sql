ALTER TABLE "app"."agents" ALTER COLUMN "image" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "app"."agents" ALTER COLUMN "category" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "app"."agents" ALTER COLUMN "category" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."agents" ALTER COLUMN "wallet" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "app"."agents" ALTER COLUMN "wallet" DROP NOT NULL;