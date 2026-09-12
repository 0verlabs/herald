import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import { JobSummaryFragment } from "../../.generated/erc-8183";
import { Env } from "../env";
import { parseTimestamp } from "../utils/timestamp";

const jobActivitySchema = z.object({
  kind: z.string(),
  address: z.string().nullable(),
  amount: z.string().nullable(),
  timestamp: z.number(),
  txHash: z.string(),
});

const jobSummarySchema = z.object({
  id: z.string(),
  status: z.string(),
  client: z.string(),
  provider: z.string().nullable(),
  evaluator: z.string(),
  agentId: z.string().nullable(),
  description: z.string(),
  budget: z
    .object({
      amount: z.string(),
      token: z.string(),
    })
    .nullable(),
  expiresAt: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
  activities: z.array(jobActivitySchema),
});

const toJobSummary = (job: JobSummaryFragment) => ({
  id: job.jobId,
  status: job.status,
  client: job.client.address,
  provider: job.provider?.address ?? null,
  evaluator: job.evaluator.address,
  agentId: job.providerAgentId === "0" ? null : job.providerAgentId,
  description: job.description,
  budget: job.paymentToken ? { amount: job.budget, token: job.paymentToken } : null,
  expiresAt: parseTimestamp(job.expiresAt),
  createdAt: parseTimestamp(job.createdAt),
  updatedAt: parseTimestamp(job.updatedAt),
  activities: job.activities.map((activity) => ({
    kind: activity.kind,
    address: activity.actor?.address ?? null,
    amount: activity.amount ?? null,
    timestamp: parseTimestamp(activity.timestamp),
    txHash: activity.txHash,
  })),
});

export const listJobsQuerySchema = z.object({
  client: z.string().optional().openapi({ description: "Job client address" }),
  provider: z.string().optional().openapi({ description: "Job provider address" }),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(1000)
    .default(20)
    .openapi({ description: "Maximum results per query", example: 20 }),
  lastId: z.string().optional().openapi({ description: "Job id cursor from the previous page" }),
});
export const listJobsOutputSchema = z.array(jobSummarySchema);
export const listJobsRoute = createRoute({
  method: "get",
  path: "/",
  request: {
    query: listJobsQuerySchema,
  },
  responses: {
    200: {
      description: "Jobs found",
      content: {
        "application/json": {
          schema: listJobsOutputSchema,
        },
      },
    },
  },
});

export const jobHandlers = new OpenAPIHono<Env>().openapi(listJobsRoute, async (c) => {
  const query = c.req.valid("query");

  const { jobs } = await c.var.erc8183.ListJobs({
    first: query.limit,
    where: {
      ...(query.client ? { client: query.client.toLowerCase() } : {}),
      ...(query.provider ? { provider: query.provider.toLowerCase() } : {}),
      ...(query.lastId ? { jobId_gt: query.lastId } : {}),
    },
  });

  const result = listJobsOutputSchema.safeParse(jobs.map(toJobSummary));
  if (!result.success) throw new Error(result.error.message);

  return c.json(result.data);
});
