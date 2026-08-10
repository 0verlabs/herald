import { ponder } from "ponder:registry";
import { agent, agentApiService, agentMcpService } from "ponder:schema";
import { eq } from "ponder";
import { v7 } from "uuid";
import { bytesToHex, hexToBytes, isAddressEqual, slice, zeroAddress } from "viem";

import type { AgentApiService, AgentMcpService } from "../types/indentity-registry";
import {
  agentApiServiceSchema,
  agentMcpServiceSchema,
  agentRegistrationFileSchema,
  agentUriSchema,
} from "../types/indentity-registry";

ponder.on("IdentityRegistry:Registered", async ({ context, event }) => {
  const agentUriParsed = agentUriSchema.safeParse(event.args.agentURI);
  if (!agentUriParsed.success) return;

  const agentUri = agentUriParsed.data;

  const registrationFileResponse = await fetch(agentUri);
  if (!registrationFileResponse.ok) return;

  const registrationFileJson = await registrationFileResponse.json().catch(() => ({}));

  const parsed = agentRegistrationFileSchema.safeParse(registrationFileJson);
  if (!parsed.success) return;

  const registrationFile = parsed.data;

  const agentApis = registrationFile.services.filter((service) => {
    const { success } = agentApiServiceSchema.safeParse(service);

    return success;
  }) as AgentApiService[];

  const agentMcps = registrationFile.services.filter((service) => {
    const { success } = agentMcpServiceSchema.safeParse(service);

    return success;
  }) as AgentMcpService[];

  const agentId = `${context.chain.id}:${event.args.agentId}`;
  const owner = event.args.owner.toLowerCase();

  const agentApiServiceValues = agentApis.flatMap((service) =>
    service.endpoints.map((endpoint) => ({
      agentId,
      serviceId: endpoint.id,
      endpoint: new URL(endpoint.path, service.baseUrl).toString(),
      name: endpoint.name,
      description: endpoint.description,
      method: endpoint.method,
      fee: String(endpoint.fee),
    }))
  );

  const agentMcpServiceValues = agentMcps.flatMap((service) => [
    ...service.tools.map((tool) => ({
      agentId,
      serviceId: tool.id,
      endpoint: service.endpoint,
      name: tool.name,
      description: tool.description,
      type: "tool" as const,
      fee: String(tool.fee),
    })),
    ...service.prompts.map((prompt) => ({
      agentId,
      serviceId: prompt.id,
      endpoint: service.endpoint,
      name: prompt.name,
      description: prompt.description,
      type: "prompt" as const,
      fee: String(prompt.fee),
    })),
    ...service.resources.map((resource) => ({
      agentId,
      serviceId: resource.id,
      endpoint: service.endpoint,
      name: resource.name,
      description: resource.description,
      type: "resource" as const,
      fee: String(resource.fee),
    })),
  ]);

  await Promise.all([
    context.db
      .insert(agent)
      .values({
        id: agentId,
        chainId: `eip155:${context.chain.id}`,
        name: registrationFile.name,
        description: registrationFile.description,
        image: registrationFile.image,
        tags: registrationFile.tags,
        wallet: owner,
        owner,
      })
      .onConflictDoNothing(),
    ...(agentApiServiceValues.length > 0
      ? [context.db.insert(agentApiService).values(agentApiServiceValues)]
      : []),
    ...(agentMcpServiceValues.length > 0
      ? [context.db.insert(agentMcpService).values(agentMcpServiceValues)]
      : []),
  ]);
});

ponder.on("IdentityRegistry:URIUpdated", async ({ context, event }) => {
  const agentId = `${context.chain.id}:${event.args.agentId}`;

  const agentUriParsed = agentUriSchema.safeParse(event.args.newURI);
  if (!agentUriParsed.success) return;

  const agentUri = agentUriParsed.data;

  const registrationFileResponse = await fetch(agentUri);
  if (!registrationFileResponse.ok) return;

  const registrationFileJson = await registrationFileResponse.json().catch(() => ({}));

  const parsed = agentRegistrationFileSchema.safeParse(registrationFileJson);
  if (!parsed.success) return;

  const registrationFile = parsed.data;

  const agentApis = registrationFile.services.filter((service) => {
    const { success } = agentApiServiceSchema.safeParse(service);

    return success;
  }) as AgentApiService[];

  const agentMcps = registrationFile.services.filter((service) => {
    const { success } = agentMcpServiceSchema.safeParse(service);

    return success;
  }) as AgentMcpService[];

  const agentApiServiceValues = agentApis.flatMap((service) =>
    service.endpoints.map((endpoint) => ({
      id: v7(),
      agentId,
      serviceId: endpoint.id,
      endpoint: new URL(endpoint.path, service.baseUrl).toString(),
      name: endpoint.name,
      description: endpoint.description,
      method: endpoint.method,
      fee: String(endpoint.fee),
    }))
  );

  const agentMcpServiceValues = agentMcps.flatMap((service) => [
    ...service.tools.map((tool) => ({
      id: v7(),
      agentId,
      serviceId: tool.id,
      endpoint: service.endpoint,
      name: tool.name,
      description: tool.description,
      type: "tool" as const,
      fee: String(tool.fee),
    })),
    ...service.prompts.map((prompt) => ({
      id: v7(),
      agentId,
      serviceId: prompt.id,
      endpoint: service.endpoint,
      name: prompt.name,
      description: prompt.description,
      type: "prompt" as const,
      fee: String(prompt.fee),
    })),
    ...service.resources.map((resource) => ({
      id: v7(),
      agentId,
      serviceId: resource.id,
      endpoint: service.endpoint,
      name: resource.name,
      description: resource.description,
      type: "resource" as const,
      fee: String(resource.fee),
    })),
  ]);

  await Promise.all([
    context.db.sql.delete(agentApiService).where(eq(agentApiService.agentId, agentId)),
    context.db.sql.delete(agentMcpService).where(eq(agentMcpService.agentId, agentId)),
  ]);

  await Promise.all([
    context.db.update(agent, { id: agentId }).set({
      chainId: `eip155:${context.chain.id}`,
      name: registrationFile.name,
      description: registrationFile.description,
      image: registrationFile.image,
      tags: registrationFile.tags,
    }),
    ...(agentApiServiceValues.length > 0
      ? [context.db.insert(agentApiService).values(agentApiServiceValues)]
      : []),
    ...(agentMcpServiceValues.length > 0
      ? [context.db.insert(agentMcpService).values(agentMcpServiceValues)]
      : []),
  ]);
});

ponder.on("IdentityRegistry:MetadataSet", async ({ context, event }) => {
  if (event.args.metadataKey !== "agentWallet") return;

  const agentId = `${context.chain.id}:${event.args.agentId}`;

  const bytes = hexToBytes(event.args.metadataValue);
  const addressBytes = slice(bytes, bytes.length - 20);
  const address = bytesToHex(addressBytes, { size: 20 });

  const isEmptyAddress = isAddressEqual(address, zeroAddress);

  await context.db.update(agent, { id: agentId }).set({ wallet: isEmptyAddress ? null : address });
});

ponder.on("IdentityRegistry:Transfer", async ({ context, event }) => {
  const isMint = isAddressEqual(event.args.from, zeroAddress);
  if (isMint) return;

  const agentId = `${context.chain.id}:${event.args.tokenId}`;

  await context.db
    .update(agent, { id: agentId })
    .set({ wallet: null, owner: event.args.to.toLowerCase() });
});
