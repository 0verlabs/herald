import { z } from "zod";

export const featuredAgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  image: z.string(),
  score: z.number().min(0).max(100),
  calls: z.number().nonnegative(),
  position: z.number(),
});

export type FeaturedAgent = z.infer<typeof featuredAgentSchema>;
