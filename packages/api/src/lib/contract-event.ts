import { z } from "zod";

export const createEventSchema = <TEventName extends string, TArgs extends z.ZodObject>(
  name: TEventName,
  args: TArgs
) =>
  z.object({
    id: z.string(),
    blockNumber: z.number(),
    transactionHash: z.string(),
    address: z.string(),
    eventName: z.literal(name),
    args,
    timestamp: z.number(),
  });
