import { z } from "zod";

// MCP structuredContent must be a JSON object and the list endpoints return
// arrays, so tool outputs wrap the API schema in { result }.
export const toolOutputSchema = <T extends z.ZodType>(schema: T) => z.object({ result: schema });

export const errorResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  isError: true,
});

export const jsonResult = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data) }],
  structuredContent: { result: data },
});
