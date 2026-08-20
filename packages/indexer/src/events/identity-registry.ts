import { ponder } from "ponder:registry";
import { agent } from "ponder:schema";
import { bytesToHex, hexToBytes, isAddressEqual, slice, zeroAddress } from "viem";

import { formatAgentId, getAgentRegistrationFileFromUri } from "../utils/agents";
import { getChainById } from "../utils/chains";

ponder.on("IdentityRegistry:Registered", async ({ context, event }) => {
  const chain = getChainById(context.chain.id);
  if (!chain) return;

  const agentRegistrationFile = await getAgentRegistrationFileFromUri(event.args.agentURI);
  if (!agentRegistrationFile) return;

  const owner = event.args.owner.toLowerCase();

  const onchainAgentId = event.args.agentId.toString();
  const agentId = formatAgentId(chain, onchainAgentId);

  await context.db
    .insert(agent)
    .values({
      id: agentId,
      chain,
      onchain_agent_id: onchainAgentId,
      name: agentRegistrationFile.name,
      description: agentRegistrationFile.description,
      image: agentRegistrationFile.image,
      tags: agentRegistrationFile.tags,
      supported_trusts: agentRegistrationFile.supportedTrust,
      wallet: owner,
      owner,
    })
    .onConflictDoNothing();
});

ponder.on("IdentityRegistry:URIUpdated", async ({ context, event }) => {
  const chain = getChainById(context.chain.id);
  if (!chain) return;
  const agentRegistrationFile = await getAgentRegistrationFileFromUri(event.args.newURI);
  if (!agentRegistrationFile) return;

  const agentId = formatAgentId(chain, event.args.agentId);

  await context.db.update(agent, { id: agentId }).set({
    name: agentRegistrationFile.name,
    description: agentRegistrationFile.description,
    image: agentRegistrationFile.image,
    tags: agentRegistrationFile.tags,
  });
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

  await context.db.update(agent, { id: agentId }).set({ wallet: isEmptyAddress ? null : address });
});

ponder.on("IdentityRegistry:Transfer", async ({ context, event }) => {
  const isMint = isAddressEqual(event.args.from, zeroAddress);
  if (isMint) return;

  const chain = getChainById(context.chain.id);
  if (!chain) return;

  const agentId = formatAgentId(chain, event.args.tokenId);

  await context.db
    .update(agent, { id: agentId })
    .set({ wallet: null, owner: event.args.to.toLowerCase() });
});
