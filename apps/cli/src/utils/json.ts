import { z } from "zod";

export const jsonStringSchema = z.string().transform((str, ctx) => {
  try {
    return JSON.parse(str);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Invalid JSON format";

    ctx.addIssue({
      code: "invalid_format",
      format: "json_string",
      input: str,
      message: message,
    });

    return z.NEVER;
  }
});
