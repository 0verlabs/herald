import pc from "picocolors";
import { z } from "zod";
import { zodCommand } from "zod-commander";
import { api, requestJson, requireOnchainAgentId } from "../lib/api.ts";
import { openSession, requireWallet } from "../lib/session.ts";
import { activeChain } from "../utils/chain.ts";
import { CliError } from "../utils/errors.ts";
import { err, isJson, ok, shortAddress, truncate } from "../utils/result.ts";

const jobStatuses = ["OPEN", "FUNDED", "SUBMITTED", "COMPLETED", "REJECTED", "EXPIRED"] as const;

const list = zodCommand({
  name: "list",
  description: "List ACP jobs this account created, or jobs assigned to its agents",
  opts: {
    assigned: z
      .boolean()
      .prefault(false)
      .describe("a;List jobs created for your agents instead of jobs you created"),
    "agent-id": z
      .string()
      .optional()
      .describe("Only jobs assigned to this onchain agent id (requires --assigned)"),
    status: z.enum(jobStatuses).optional().describe("s;Filter by job status"),
    limit: z.coerce
      .number()
      .int()
      .positive()
      .max(1000)
      .prefault(20)
      .describe("l;Maximum results per page"),
    skip: z.coerce.number().int().nonnegative().prefault(0).describe("Number of results to skip"),
  },
  action: async (_args, opts) => {
    const json = isJson(list);
    // commander camelCases --agent-id; zod-commander's opts type keeps the literal key.
    const agentId = (opts as { agentId?: string }).agentId;

    const result = await listJobs({
      assigned: opts.assigned,
      agentId,
      status: opts.status,
      limit: opts.limit,
      skip: opts.skip,
    }).catch((error: Error) => error);
    if (result instanceof Error) return err(result)(json);
    if (result.jobs.length === 0)
      return ok(
        pc.dim(
          result.assigned ? "No jobs assigned to your agents." : "No jobs created by this wallet.",
        ),
        result,
      )(json);

    ok(
      [
        ...result.jobs.map((job) => jobLine(job, result.assigned)),
        ...(result.jobs.length === opts.limit
          ? ["", pc.dim(`More results may exist — re-run with --skip ${opts.skip + opts.limit}.`)]
          : []),
      ].join("\n"),
      result,
    )(json);
  },
});

async function listJobs(opts: {
  assigned: boolean;
  agentId?: string;
  status?: (typeof jobStatuses)[number];
  limit: number;
  skip: number;
}) {
  if (opts.agentId !== undefined && !opts.assigned)
    throw new CliError("FLAG_CONFLICT", "--agent-id only filters assigned jobs; add --assigned.");

  const address = requireWallet(await openSession(), activeChain).address;
  const jobs = await requestJson(
    api.v1.jobs.$get({
      query: {
        ...(opts.assigned ? { provider: address } : { client: address }),
        ...(opts.agentId !== undefined && { agentId: requireOnchainAgentId(opts.agentId) }),
        ...(opts.status && { status: opts.status }),
        limit: String(opts.limit),
        skip: String(opts.skip),
      },
    }),
  );

  return { address, assigned: opts.assigned, jobs };
}

type JobSummary = Awaited<ReturnType<typeof listJobs>>["jobs"][number];

function jobLine(job: JobSummary, assigned: boolean): string {
  return `${pc.cyan(`#${job.id}`)}  ${statusLabel(job.status)}  ${truncate(job.description, 48)}  ${pc.dim(
    counterparty(job, assigned),
  )}`;
}

function statusLabel(status: string): string {
  const padded = status.padEnd(9);
  if (status === "COMPLETED") return pc.green(padded);
  if (status === "REJECTED" || status === "EXPIRED") return pc.red(padded);
  if (status === "SUBMITTED") return pc.yellow(padded);
  return pc.cyan(padded);
}

function counterparty(job: JobSummary, assigned: boolean): string {
  if (assigned)
    return `from ${shortAddress(job.client)}${job.agentId ? ` for agent #${job.agentId}` : ""}`;
  if (job.agentId) return `agent #${job.agentId}`;
  if (job.provider) return `provider ${shortAddress(job.provider)}`;
  return "unassigned";
}

export const job = zodCommand({
  name: "job",
  description: "Browse ACP jobs involving this account",
}).addCommand(list);
