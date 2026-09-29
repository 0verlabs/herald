import fs from "node:fs/promises";
import { type EvmChain, viemChainByChain, type Wallet } from "@hrld/core";
import { erc8004IdentityRegistryAbi } from "@hrld/core/abis/erc8004";
import pc from "picocolors";
import { v4 as uuidv4 } from "uuid";
import { createPublicClient, createWalletClient, http, parseEventLogs } from "viem";
import { z } from "zod";
import { zodCommand } from "zod-commander";
import {
  type AgentCard,
  type AgentService,
  identityRegistryByChain,
  listAgentCards,
  normalizeCard,
  parseAgentCard,
  parseAgentService,
  readAgentCard,
  requireJsonObject,
  toAgentUri,
  writeAgentCard,
} from "../lib/agents.ts";
import { openSession, requireUserId, requireWallet } from "../lib/session.ts";
import type { WalletSession } from "../lib/privy.ts";
import { toWalletAccount } from "../lib/viem.ts";
import { activeChain, chainDisplayName } from "../utils/chain.ts";
import { CliError } from "../utils/errors.ts";
import { jsonStringSchema } from "../utils/json.ts";
import { err, fields, isJson, ok, success } from "../utils/result.ts";

const list = zodCommand({
  name: "list",
  description: "List this account's local agents",
  action: async () => {
    const json = isJson(list);

    const result = await listAgents().catch((error: Error) => error);
    if (result instanceof Error) return err(result)(json);
    if (result.agents.length === 0)
      return ok(pc.dim("No agents yet. Run `hrld agent create`."), result)(json);

    ok(
      result.agents
        .map(
          (agent) =>
            `${pc.cyan(agent.id)}  ${agent.card.name}  ${pc.dim(
              `${agent.card.services.length} service${agent.card.services.length === 1 ? "" : "s"}, ${registrationLabel(agent.card)}`,
            )}`,
        )
        .join("\n"),
      result,
    )(json);
  },
});

async function listAgents() {
  const userId = await requireUserId();
  return { userId, agents: await listAgentCards(userId) };
}

function registrationLabel(card: AgentCard): string {
  const registration = card.registrations?.[0];
  return registration ? `synced as #${registration.agentId}` : "local only";
}

const create = zodCommand({
  name: "create",
  description: "Create a local ERC-8004 agent card",
  opts: {
    name: z.string().optional().describe("n;Agent name"),
    description: z.string().optional().describe("d;Agent description"),
    image: z.string().optional().describe("i;Agent image URI"),
    data: jsonStringSchema.optional().describe("Full agent card as a JSON string"),
    file: z.string().optional().describe("f;Path to an agent card JSON file"),
  },
  action: async (_args, opts) => {
    const json = isJson(create);

    const result = await createAgent(opts).catch((error: Error) => error);
    if (result instanceof Error) return err(result)(json);

    ok(
      [
        success("Agent created"),
        fields([
          ["ID", pc.cyan(result.id)],
          ["Name", pc.bold(result.card.name)],
          ["Card", result.path],
        ]),
      ].join("\n"),
      result,
    )(json);
  },
});

async function createAgent(opts: {
  name?: string;
  description?: string;
  image?: string;
  data?: unknown;
  file?: string;
}) {
  const userId = await requireUserId();
  const provided = await resolveCardInput(opts);

  if (provided !== null && (opts.name || opts.description || opts.image))
    throw new CliError(
      "FLAG_CONFLICT",
      "--data/--file provide the full agent card and cannot be combined with --name, --description or --image.",
    );
  if (provided === null && (!opts.name || !opts.description))
    throw new CliError(
      "FLAG_MISSING",
      "Provide --name and --description, or a full agent card via --data/--file.",
    );

  const card = parseAgentCard(
    provided ?? {
      name: opts.name,
      description: opts.description,
      ...(opts.image && { image: opts.image }),
    },
  );

  const id = uuidv4();
  const path = await writeAgentCard(userId, id, stampUpdatedAt(card, provided));
  return { id, card, path };
}

const profile = zodCommand({
  name: "profile",
  description: "Show a local agent's card",
  args: {
    agentId: z.string().describe("Local agent id (uuid)"),
  },
  action: async (args) => {
    const json = isJson(profile);

    const result = await readProfile(args.agentId).catch((error: Error) => error);
    if (result instanceof Error) return err(result)(json);

    const registrations = result.card.registrations ?? [];
    ok(
      [
        fields([
          ["ID", pc.cyan(result.id)],
          ["Name", pc.bold(result.card.name)],
          ["Description", result.card.description],
          ...(result.card.image ? [["Image", result.card.image] as [string, unknown]] : []),
        ]),
        "",
        pc.dim("Registrations"),
        ...(registrations.length > 0
          ? registrations.map(
              (registration) =>
                `  #${registration.agentId} on ${pc.cyan(registration.agentRegistry)}`,
            )
          : [pc.dim("  none — run `hrld agent sync <agentId>`")]),
        "",
        pc.dim("Services"),
        ...(result.card.services.length > 0
          ? result.card.services.map((service, index) => `  ${serviceLine(service, index)}`)
          : [pc.dim("  none")]),
      ].join("\n"),
      result,
    )(json);
  },
});

async function readProfile(agentId: string) {
  const userId = await requireUserId();
  return { id: agentId, card: await readAgentCard(userId, agentId) };
}

const update = zodCommand({
  name: "update",
  description: "Update a local agent card",
  args: {
    agentId: z.string().describe("Local agent id (uuid)"),
  },
  opts: {
    name: z.string().optional().describe("n;Agent name"),
    description: z.string().optional().describe("d;Agent description"),
    image: z.string().optional().describe("i;Agent image URI"),
    data: jsonStringSchema.optional().describe("Card fields to merge in, as a JSON string"),
    file: z.string().optional().describe("f;Path to a JSON file with card fields to merge in"),
  },
  action: async (args, opts) => {
    const json = isJson(update);

    const result = await updateAgent(args.agentId, opts).catch((error: Error) => error);
    if (result instanceof Error) return err(result)(json);

    ok(
      [
        success("Agent updated"),
        fields([
          ["ID", pc.cyan(result.id)],
          ["Name", pc.bold(result.card.name)],
        ]),
      ].join("\n"),
      result,
    )(json);
  },
});

async function updateAgent(
  agentId: string,
  opts: { name?: string; description?: string; image?: string; data?: unknown; file?: string },
) {
  const userId = await requireUserId();
  const card = await readAgentCard(userId, agentId);
  const provided = await resolveCardInput(opts);

  if (provided === null && !opts.name && !opts.description && !opts.image)
    throw new CliError(
      "FLAG_MISSING",
      "Provide at least one of --name, --description, --image, --data or --file.",
    );

  // Merge order: stored card, then --data/--file fields, then explicit flags.
  const merged = parseAgentCard({
    ...card,
    ...provided,
    ...(opts.name && { name: opts.name }),
    ...(opts.description && { description: opts.description }),
    ...(opts.image && { image: opts.image }),
  });

  const next = stampUpdatedAt(merged, provided);
  await writeAgentCard(userId, agentId, next);
  return { id: agentId, card: next };
}

// --data and --file both carry arbitrary JSON for card fields the flags don't
// cover (active, x402Support, supportedTrust, …); only one source may be
// given. Legacy `endpoints` input is normalized here so merges into cards that
// already have `services` don't leave both fields behind.
async function resolveCardInput(opts: {
  data?: unknown;
  file?: string;
}): Promise<Record<string, unknown> | null> {
  if (opts.data !== undefined && opts.file !== undefined)
    throw new CliError("FLAG_CONFLICT", "--data and --file cannot be combined.");
  if (opts.data !== undefined) return normalizeCard(requireJsonObject(opts.data, "--data"));
  if (opts.file === undefined) return null;

  const raw = await fs.readFile(opts.file, "utf8").catch(() => null);
  if (raw === null) throw new CliError("FILE_NOT_FOUND", `No such file: ${opts.file}`);

  const parsed = jsonStringSchema.safeParse(raw);
  if (!parsed.success) throw new CliError("AGENT_CARD_INVALID", `${opts.file} is not valid JSON.`);

  return normalizeCard(requireJsonObject(parsed.data, opts.file));
}

// Mutations stamp `updatedAt` (unix seconds, per the ERC-8004 profile) unless
// --data/--file set it explicitly — full-card input stays authoritative.
function stampUpdatedAt(card: AgentCard, provided: Record<string, unknown> | null): AgentCard {
  if (provided !== null && "updatedAt" in provided) return card;
  return { ...card, updatedAt: Math.floor(Date.now() / 1000) };
}

const serviceList = zodCommand({
  name: "list",
  description: "List a local agent's services",
  args: {
    agentId: z.string().describe("Local agent id (uuid)"),
  },
  action: async (args) => {
    const json = isJson(serviceList);

    const result = await listServices(args.agentId).catch((error: Error) => error);
    if (result instanceof Error) return err(result)(json);
    if (result.services.length === 0)
      return ok(
        pc.dim(
          "No services yet. Run `hrld agent service add <agentId> --name <name> --endpoint <uri>`.",
        ),
        result,
      )(json);

    ok(
      result.services.map((service, index) => serviceLine(service, index)).join("\n"),
      result,
    )(json);
  },
});

async function listServices(agentId: string) {
  const userId = await requireUserId();
  return { id: agentId, services: (await readAgentCard(userId, agentId)).services };
}

function serviceLine(service: AgentService, index: number): string {
  return `${pc.dim(`[${index}]`)} ${service.name}  ${pc.cyan(service.endpoint)}${
    service.version ? `  ${pc.dim(service.version)}` : ""
  }`;
}

const serviceAdd = zodCommand({
  name: "add",
  description: "Add a service to a local agent card",
  args: {
    agentId: z.string().describe("Local agent id (uuid)"),
  },
  opts: {
    name: z.string().describe("n;Service name, e.g. MCP, A2A, web"),
    endpoint: z.string().describe("e;Service endpoint URI"),
    version: z.string().optional().describe("v;Protocol version"),
    data: jsonStringSchema
      .optional()
      .describe("d;Extra service fields as JSON, e.g. mcpTools or capabilities"),
  },
  action: async (args, opts) => {
    const json = isJson(serviceAdd);

    const result = await addService(args.agentId, opts).catch((error: Error) => error);
    if (result instanceof Error) return err(result)(json);

    ok(`${success("Service added")}\n${serviceLine(result.service, result.index)}`, result)(json);
  },
});

async function addService(
  agentId: string,
  opts: { name: string; endpoint: string; version?: string; data?: unknown },
) {
  const userId = await requireUserId();
  const card = await readAgentCard(userId, agentId);

  const service = parseAgentService({
    ...(opts.data === undefined ? {} : requireJsonObject(opts.data, "--data")),
    name: opts.name,
    endpoint: opts.endpoint,
    ...(opts.version && { version: opts.version }),
  });

  const services = [...card.services, service];
  await writeAgentCard(userId, agentId, stampUpdatedAt({ ...card, services }, null));
  return { id: agentId, index: services.length - 1, service };
}

const serviceUpdate = zodCommand({
  name: "update",
  description: "Update a service on a local agent card",
  args: {
    agentId: z.string().describe("Local agent id (uuid)"),
    serviceIndex: z.coerce
      .number()
      .int()
      .nonnegative()
      .describe("Service index from `hrld agent service list`"),
  },
  opts: {
    name: z.string().optional().describe("n;Service name"),
    endpoint: z.string().optional().describe("e;Service endpoint URI"),
    version: z.string().optional().describe("v;Protocol version"),
    data: jsonStringSchema.optional().describe("d;Service fields to merge in, as JSON"),
  },
  action: async (args, opts) => {
    const json = isJson(serviceUpdate);

    const result = await updateService(args.agentId, args.serviceIndex, opts).catch(
      (error: Error) => error,
    );
    if (result instanceof Error) return err(result)(json);

    ok(`${success("Service updated")}\n${serviceLine(result.service, result.index)}`, result)(json);
  },
});

async function updateService(
  agentId: string,
  index: number,
  opts: { name?: string; endpoint?: string; version?: string; data?: unknown },
) {
  const userId = await requireUserId();
  const card = await readAgentCard(userId, agentId);
  const existing = requireService(card, agentId, index);

  if (!opts.name && !opts.endpoint && !opts.version && opts.data === undefined)
    throw new CliError(
      "FLAG_MISSING",
      "Provide at least one of --name, --endpoint, --version or --data.",
    );

  const service = parseAgentService({
    ...existing,
    ...(opts.data === undefined ? {} : requireJsonObject(opts.data, "--data")),
    ...(opts.name && { name: opts.name }),
    ...(opts.endpoint && { endpoint: opts.endpoint }),
    ...(opts.version && { version: opts.version }),
  });

  const services = card.services.map((entry, i) => (i === index ? service : entry));
  await writeAgentCard(userId, agentId, stampUpdatedAt({ ...card, services }, null));
  return { id: agentId, index, service };
}

const serviceRemove = zodCommand({
  name: "remove",
  description: "Remove a service from a local agent card",
  args: {
    agentId: z.string().describe("Local agent id (uuid)"),
    serviceIndex: z.coerce
      .number()
      .int()
      .nonnegative()
      .describe("Service index from `hrld agent service list`"),
  },
  action: async (args) => {
    const json = isJson(serviceRemove);

    const result = await removeService(args.agentId, args.serviceIndex).catch(
      (error: Error) => error,
    );
    if (result instanceof Error) return err(result)(json);

    ok(`${success("Service removed")}\n${serviceLine(result.service, result.index)}`, result)(json);
  },
});

async function removeService(agentId: string, index: number) {
  const userId = await requireUserId();
  const card = await readAgentCard(userId, agentId);
  const existing = requireService(card, agentId, index);

  const services = card.services.filter((_, i) => i !== index);
  await writeAgentCard(userId, agentId, stampUpdatedAt({ ...card, services }, null));
  return { id: agentId, index, service: existing };
}

function requireService(card: AgentCard, agentId: string, index: number): AgentService {
  const service = card.services[index];
  if (!service)
    throw new CliError(
      "AGENT_SERVICE_NOT_FOUND",
      `Agent ${agentId} has no service at index ${index}.`,
      "Run `hrld agent service list <agentId>` to see service indexes.",
    );

  return service;
}

const sync = zodCommand({
  name: "sync",
  description: "Publish a local agent card to the onchain ERC-8004 identity registry",
  args: {
    agentId: z.string().describe("Local agent id (uuid)"),
  },
  opts: {
    "dry-run": z
      .boolean()
      .prefault(false)
      .describe("Show what sync would do without sending transactions"),
  },
  action: async (args, opts) => {
    const json = isJson(sync);
    // commander camelCases --dry-run; zod-commander's opts type keeps the literal key.
    const dryRun = (opts as { dryRun?: boolean }).dryRun === true;

    const result = await syncAgent(activeChain, args.agentId, dryRun, json).catch(
      (error: Error) => error,
    );
    if (result instanceof Error) return err(result)(json);

    if (result.dryRun)
      return ok(
        fields([
          ["Agent", `${pc.bold(result.name)} ${pc.dim(`(${result.id})`)}`],
          ["Chain", pc.bold(chainDisplayName[result.chain])],
          ["Wallet", pc.cyan(result.address)],
          ["Registry", result.agentRegistry],
          [
            "Onchain Agent ID",
            result.onchainAgentId === null
              ? pc.dim("none — register() will assign one")
              : `#${result.onchainAgentId}`,
          ],
          ["Steps", result.steps.join(" → ")],
          ...(result.agentUri
            ? [
                [
                  "Agent URI",
                  `${result.agentUri.slice(0, 64)}… (${result.agentUri.length} bytes)`,
                ] as [string, unknown],
              ]
            : []),
        ]),
        result,
      )(json);

    ok(
      [
        success("Agent synced"),
        fields([
          ["Agent", `${pc.bold(result.name)} ${pc.dim(`(${result.id})`)}`],
          ["Chain", pc.bold(chainDisplayName[result.chain])],
          ["Onchain Agent ID", `#${result.onchainAgentId}`],
          ["Registry", result.agentRegistry],
          ...(result.registerTxHash
            ? [["Register Tx", pc.cyan(result.registerTxHash)] as [string, unknown]]
            : []),
          ["Set URI Tx", pc.cyan(result.setUriTxHash)],
        ]),
      ].join("\n"),
      result,
    )(json);
  },
});

async function syncAgent(chain: EvmChain, agentId: string, dryRun: boolean, json: boolean) {
  const userId = await requireUserId();
  const card = await readAgentCard(userId, agentId);
  const session = await openSession();
  const wallet = requireWallet(session, chain);

  const agentRegistry = `eip155:${viemChainByChain[chain].id}:${identityRegistryByChain[chain]}`;
  const existing = card.registrations?.find((entry) => entry.agentRegistry === agentRegistry);

  if (dryRun)
    return {
      dryRun: true as const,
      chain,
      id: agentId,
      name: card.name,
      address: wallet.address,
      agentRegistry,
      onchainAgentId: existing?.agentId ?? null,
      steps: existing ? ["setAgentURI"] : ["register", "setAgentURI"],
      agentUri: existing ? toAgentUri(card) : null,
    };

  const registered = existing
    ? { registration: existing, txHash: null }
    : await registerAgent(chain, session, wallet, agentRegistry, json);

  // The onchain id is persisted before setAgentURI so a failure there cannot
  // orphan the registration; re-running sync then skips register().
  const next = {
    ...card,
    registrations: [
      ...(card.registrations ?? []).filter((entry) => entry.agentRegistry !== agentRegistry),
      registered.registration,
    ],
  };
  if (!existing) await writeAgentCard(userId, agentId, next);

  const agentUri = toAgentUri(next);
  progress(json, `Setting agent URI (${agentUri.length} bytes)…`);
  const setUriTxHash = await createWalletClient({
    account: toWalletAccount(session, wallet),
    chain: viemChainByChain[chain],
    transport: http(),
  }).writeContract({
    address: identityRegistryByChain[chain],
    abi: erc8004IdentityRegistryAbi,
    functionName: "setAgentURI",
    args: [BigInt(registered.registration.agentId), agentUri],
  });
  await createPublicClient({
    chain: viemChainByChain[chain],
    transport: http(),
  }).waitForTransactionReceipt({ hash: setUriTxHash });

  return {
    dryRun: false as const,
    chain,
    id: agentId,
    name: next.name,
    address: wallet.address,
    agentRegistry,
    onchainAgentId: registered.registration.agentId,
    registerTxHash: registered.txHash,
    setUriTxHash,
    agentUri,
  };
}

// register() is called without a URI because the onchain agent id only exists
// after the transaction confirms — and both the card's registrations entry and
// the final data URI need that id.
async function registerAgent(
  chain: EvmChain,
  session: WalletSession,
  wallet: Wallet,
  agentRegistry: string,
  json: boolean,
) {
  progress(json, "Registering agent onchain…");
  const txHash = await createWalletClient({
    account: toWalletAccount(session, wallet),
    chain: viemChainByChain[chain],
    transport: http(),
  }).writeContract({
    address: identityRegistryByChain[chain],
    abi: erc8004IdentityRegistryAbi,
    functionName: "register",
    args: [],
  });

  const receipt = await createPublicClient({
    chain: viemChainByChain[chain],
    transport: http(),
  }).waitForTransactionReceipt({ hash: txHash });
  const events = parseEventLogs({
    abi: erc8004IdentityRegistryAbi,
    logs: receipt.logs,
    eventName: "Registered",
  });

  const onchainAgentId = events[0]?.args.agentId;
  if (onchainAgentId === undefined)
    throw new CliError(
      "AGENT_SYNC_FAILED",
      "The register transaction confirmed but emitted no Registered event.",
      `Inspect transaction ${txHash}, then re-run \`hrld agent sync\`.`,
    );

  return { registration: { agentId: Number(onchainAgentId), agentRegistry }, txHash };
}

function progress(json: boolean, message: string) {
  // Progress goes to stderr so stdout stays parseable in both output modes.
  if (!json) process.stderr.write(pc.dim(`${message}\n`));
}

const service = zodCommand({
  name: "service",
  description: "Manage a local agent card's services",
})
  .addCommand(serviceList)
  .addCommand(serviceAdd)
  .addCommand(serviceUpdate)
  .addCommand(serviceRemove);

export const agent = zodCommand({
  name: "agent",
  description: "Manage local ERC-8004 agent cards and sync them onchain",
})
  .addCommand(list)
  .addCommand(create)
  .addCommand(profile)
  .addCommand(update)
  .addCommand(service)
  .addCommand(sync);
