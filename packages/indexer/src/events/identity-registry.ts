import { ponder } from "ponder:registry";
import { agent, agentApiService, agentMcpService } from "ponder:schema";
import { eq } from "ponder";
import { bytesToHex, hexToBytes, hexToString, isAddressEqual, slice, zeroAddress } from "viem";

import type { AgentApiService, AgentMcpService, AgentService } from "../types/identity-registry";
import { agentApiServiceSchema, agentMcpServiceSchema } from "../types/identity-registry";
import { resolveAgentRegistrationFileFromUri } from "../utils/agents";
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
      supported_trusts: agentRegistrationFile.supportedTrust,
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

  const agentId = event.args.agentId.toString();

  const [existingAgent] = await context.db.sql
    .select({ id: agent.id })
    .from(agent)
    .where(eq(agent.agent_id, agentId));
  if (!existingAgent) return;

  await context.db.update(agent, { id: existingAgent.id }).set({
    name: agentRegistrationFile.name,
    description: agentRegistrationFile.description,
    image: agentRegistrationFile.image,
    supported_trusts: agentRegistrationFile.supportedTrust,
    active: agentRegistrationFile.active,
  });

  await syncAgentServices(context.db, agentId, agentRegistrationFile.services ?? []);
});

ponder.on("IdentityRegistry:MetadataSet", async ({ context, event }) => {
  const chain = getChainById(context.chain.id);
  if (!chain) return;

  const agentId = event.args.agentId.toString();

  const [existingAgent] = await context.db.sql
    .select({ id: agent.id })
    .from(agent)
    .where(eq(agent.agent_id, agentId));
  if (!existingAgent) return;

  switch (event.args.metadataKey) {
    case "agentWallet": {
      const bytes = hexToBytes(event.args.metadataValue);
      const addressBytes = slice(bytes, bytes.length - 20);
      const address = bytesToHex(addressBytes, { size: 20 });

      const isEmptyAddress = isAddressEqual(address, zeroAddress);

      await context.db
        .update(agent, { id: existingAgent.id })
        .set({ wallet: isEmptyAddress ? null : address });
      break;
    }
    case "category":
      await context.db
        .update(agent, { id: existingAgent.id })
        .set({ category: hexToString(event.args.metadataValue) });
      break;
  }
});

ponder.on("IdentityRegistry:Transfer", async ({ context, event }) => {
  const isMint = isAddressEqual(event.args.from, zeroAddress);
  if (isMint) return;

  const chain = getChainById(context.chain.id);
  if (!chain) return;

  const agentId = event.args.tokenId.toString();

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
