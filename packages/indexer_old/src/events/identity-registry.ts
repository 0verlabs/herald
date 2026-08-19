import { ponder } from "ponder:registry";
import { agent } from "ponder:schema";
import { chainFromId } from "@hrld/core";
import { bytesToHex, hexToBytes, isAddressEqual, slice, zeroAddress } from "viem";

import { agentRegistrationFileSchema, agentUriSchema } from "../types/identity-registry";

ponder.on("IdentityRegistry:Registered", async ({ context, event }) => {
  const chain = chainFromId(context.chain.id);
  if (!chain) return;

  const registrationFile = await fetchRegistrationFile(event.args.agentURI);
  if (!registrationFile) return;

  const owner = event.args.owner.toLowerCase();

  await context.db
    .insert(agent)
    .values({
      id: `${chain}:${event.args.agentId}`,
      chain,
      onChainAgentId: event.args.agentId,
      name: registrationFile.name,
      description: registrationFile.description,
      image: registrationFile.image,
      tags: registrationFile.tags,
      wallet: owner,
      owner,
    })
    .onConflictDoNothing();
});

ponder.on("IdentityRegistry:URIUpdated", async ({ context, event }) => {
  const chain = chainFromId(context.chain.id);
  if (!chain) return;

  const registrationFile = await fetchRegistrationFile(event.args.newURI);
  if (!registrationFile) return;

  await context.db.update(agent, { id: `${chain}:${event.args.agentId}` }).set({
    name: registrationFile.name,
    description: registrationFile.description,
    image: registrationFile.image,
    tags: registrationFile.tags,
  });
});

ponder.on("IdentityRegistry:MetadataSet", async ({ context, event }) => {
  if (event.args.metadataKey !== "agentWallet") return;

  const chain = chainFromId(context.chain.id);
  if (!chain) return;

  const bytes = hexToBytes(event.args.metadataValue);
  const addressBytes = slice(bytes, bytes.length - 20);
  const address = bytesToHex(addressBytes, { size: 20 });

  const isEmptyAddress = isAddressEqual(address, zeroAddress);

  await context.db
    .update(agent, { id: `${chain}:${event.args.agentId}` })
    .set({ wallet: isEmptyAddress ? null : address });
});

ponder.on("IdentityRegistry:Transfer", async ({ context, event }) => {
  const isMint = isAddressEqual(event.args.from, zeroAddress);
  if (isMint) return;

  const chain = chainFromId(context.chain.id);
  if (!chain) return;

  await context.db
    .update(agent, { id: `${chain}:${event.args.tokenId}` })
    .set({ wallet: null, owner: event.args.to.toLowerCase() });
});

async function fetchRegistrationFile(uri: string) {
  const agentUriParsed = agentUriSchema.safeParse(uri);
  if (!agentUriParsed.success) return;

  const response = await fetch(agentUriParsed.data);
  if (!response.ok) return;

  const json = await response.json().catch(() => ({}));

  const parsed = agentRegistrationFileSchema.safeParse(json);
  if (!parsed.success) return;

  return parsed.data;
}
