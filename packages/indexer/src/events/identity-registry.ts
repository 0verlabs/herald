import type { AgentApiService, AgentMcpService, AgentService } from "@hrld/core";
import { ponder } from "ponder:registry";
import { agent, agentApiService, agentMcpService } from "ponder:schema";
import { agentApiServiceSchema, agentMcpServiceSchema } from "@hrld/core";
import { eq } from "ponder";
import { bytesToHex, hexToBytes, isAddressEqual, slice, zeroAddress } from "viem";

import { formatAgentId, resolveAgentRegistrationFileFromUri } from "../utils/agents";
import { getChainById } from "../utils/chains";

ponder.on("IdentityRegistry:Registered", async ({ context, event }) => {
  const chain = getChainById(context.chain.id);
  if (!chain) return;

  const agentRegistrationFile = await resolveAgentRegistrationFileFromUri(event.args.agentURI);
  if (!agentRegistrationFile) return;

  const owner = event.args.owner.toLowerCase();

  const agentId = event.args.agentId.toString();

  await context.db
    .insert(agent)
    .values({
      chain,
      agent_id: agentId,
      name: agentRegistrationFile.name,
      description: agentRegistrationFile.description,
      image: agentRegistrationFile.image,
      tags: agentRegistrationFile.tags,
      supported_trusts: agentRegistrationFile.supportedTrust,
      x402_support: agentRegistrationFile.x402Support,
      active: agentRegistrationFile.active,
      wallet: owner,
      owner,
    })
    .onConflictDoNothing();

  await syncAgentServices(context.db, agentId, agentRegistrationFile.services ?? []);
});

ponder.on("IdentityRegistry:URIUpdated", async ({ context, event }) => {
  const chain = getChainById(context.chain.id);
  if (!chain) return;

  const agentRegistrationFile = await resolveAgentRegistrationFileFromUri(event.args.newURI);
  if (!agentRegistrationFile) return;

  const agentId = formatAgentId(chain, event.args.agentId);

  const [existingAgent] = await context.db.sql
    .select({ id: agent.id })
    .from(agent)
    .where(eq(agent.agent_id, agentId));
  if (!existingAgent) return;

  await context.db.update(agent, { id: existingAgent.id }).set({
    name: agentRegistrationFile.name,
    description: agentRegistrationFile.description,
    image: agentRegistrationFile.image,
    tags: agentRegistrationFile.tags,
    supported_trusts: agentRegistrationFile.supportedTrust,
    x402_support: agentRegistrationFile.x402Support,
    active: agentRegistrationFile.active,
  });

  await syncAgentServices(context.db, agentId, agentRegistrationFile.services ?? []);
});

ponder.on("IdentityRegistry:MetadataSet", async ({ context, event }) => {
  if (event.args.metadataKey !== "agentWallet") return;

  const chain = getChainById(context.chain.id);
  if (!chain) return;

  const bytes = hexToBytes(event.args.metadataValue);
  const addressBytes = slice(bytes, bytes.length - 20);
  const address = bytesToHex(addressBytes, { size: 20 });

  const isEmptyAddress = isAddressEqual(address, zeroAddress);

  const agentId = formatAgentId(chain, event.args.agentId);

  const [existingAgent] = await context.db.sql
    .select({ id: agent.id })
    .from(agent)
    .where(eq(agent.agent_id, agentId));
  if (!existingAgent) return;

  await context.db
    .update(agent, { id: existingAgent.id })
    .set({ wallet: isEmptyAddress ? null : address });
});

ponder.on("IdentityRegistry:Transfer", async ({ context, event }) => {
  const isMint = isAddressEqual(event.args.from, zeroAddress);
  if (isMint) return;

  const chain = getChainById(context.chain.id);
  if (!chain) return;

  const agentId = formatAgentId(chain, event.args.tokenId);

  const [existingAgent] = await context.db.sql
    .select({ id: agent.id })
    .from(agent)
    .where(eq(agent.agent_id, agentId));
  if (!existingAgent) return;

  await context.db
    .update(agent, { id: existingAgent.id })
    .set({ wallet: null, owner: event.args.to.toLowerCase() });
});

async function syncAgentServices(
  db: Parameters<Parameters<typeof ponder.on>[1]>[0]["context"]["db"],
  agentId: string,
  services: AgentService[]
) {
  const agentApiServices = (services as AgentApiService[]).filter(
    (service) => agentApiServiceSchema.safeParse(service).success
  );
  const agentMcpServices = (services as AgentMcpService[]).filter(
    (service) => agentMcpServiceSchema.safeParse(service).success
  );

  await db.sql.delete(agentApiService).where(eq(agentApiService.agent_id, agentId));
  await db.sql.delete(agentMcpService).where(eq(agentMcpService.agent_id, agentId));

  if (agentApiServices.length)
    await db
      .insert(agentApiService)
      .values(
        agentApiServices.map((service) => ({
          ...service,
          agent_id: agentId,
        }))
      )
      .onConflictDoNothing();

  if (agentMcpServices.length)
    await db
      .insert(agentMcpService)
      .values(
        agentMcpServices.map((service) => ({
          ...service,
          agent_id: agentId,
        }))
      )
      .onConflictDoNothing();
}
