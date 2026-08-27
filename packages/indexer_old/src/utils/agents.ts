import { agentRegistrationFileSchema, agentUriSchema } from "../types/identity-registry";

export const resolveAgentRegistrationFileFromUri = async (uri: string) => {
  const agentUriParsed = agentUriSchema.safeParse(uri);
  if (!agentUriParsed.success) return null;

  const response = await fetch(agentUriParsed.data);
  if (!response.ok) return null;

  const json = await response.json().catch(() => ({}));

  const parsed = agentRegistrationFileSchema.safeParse(json);
  if (!parsed.success) return null;

  return parsed.data;
};
