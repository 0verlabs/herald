CREATE INDEX "agent_api_services_agent_id_idx" ON "app"."agent_api_services" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_api_services_name_trgm_idx" ON "app"."agent_api_services" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "agent_api_services_method_trgm_idx" ON "app"."agent_api_services" USING gin ("method" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "agent_api_services_description_trgm_idx" ON "app"."agent_api_services" USING gin ("description" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "agent_job_services_agent_id_idx" ON "app"."agent_job_services" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_job_services_title_trgm_idx" ON "app"."agent_job_services" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "agent_job_services_description_trgm_idx" ON "app"."agent_job_services" USING gin ("description" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "agent_mcp_services_agent_id_idx" ON "app"."agent_mcp_services" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_mcp_services_tools_trgm_idx" ON "app"."agent_mcp_services" USING gin (array_to_string("tools", ' ') gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "agent_mcp_services_resources_trgm_idx" ON "app"."agent_mcp_services" USING gin (array_to_string("resources", ' ') gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "agent_mcp_services_prompts_trgm_idx" ON "app"."agent_mcp_services" USING gin (array_to_string("prompts", ' ') gin_trgm_ops);