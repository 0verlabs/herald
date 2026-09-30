import fs from "node:fs/promises";
import { keccak256, toBytes, zeroHash } from "viem";
import { CliError } from "../utils/errors.ts";
import { jsonStringSchema } from "../utils/json.ts";

// --data and --file both carry the off-chain document a feedback entry or
// response points at (comment, evidence, job context); only one source may
// be given.
export async function resolveFeedbackDocument(opts: {
  data?: unknown;
  file?: string;
}): Promise<Record<string, unknown> | null> {
  if (opts.data !== undefined && opts.file !== undefined)
    throw new CliError("FLAG_CONFLICT", "--data and --file cannot be combined.");
  if (opts.data !== undefined) return requireDocumentObject(opts.data, "--data");
  if (opts.file === undefined) return null;

  const raw = await fs.readFile(opts.file, "utf8").catch(() => null);
  if (raw === null) throw new CliError("FILE_NOT_FOUND", `No such file: ${opts.file}`);

  const parsed = jsonStringSchema.safeParse(raw);
  if (!parsed.success)
    throw new CliError("FEEDBACK_INPUT_INVALID", `${opts.file} is not valid JSON.`);

  return requireDocumentObject(parsed.data, opts.file);
}

function requireDocumentObject(value: unknown, source: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new CliError("FEEDBACK_INPUT_INVALID", `${source} must contain a JSON object.`);

  return value as Record<string, unknown>;
}

// Like agent cards, feedback documents go onchain as data: URIs; the hash
// commits to the exact JSON bytes so readers can verify the URI content.
export function toFeedbackUri(document: Record<string, unknown>): {
  uri: string;
  hash: `0x${string}`;
} {
  const json = JSON.stringify(document);
  return {
    uri: `data:application/json;base64,${Buffer.from(json).toString("base64")}`,
    hash: keccak256(toBytes(json)),
  };
}

// giveFeedback accepts an empty URI for score-only feedback; the zero hash
// marks "no document" per ERC-8004.
export const emptyFeedbackUri = { uri: "", hash: zeroHash } as const;

/** Renders a feedback score compactly: integers as-is, fractions to one decimal. */
export function formatScore(score: number): string {
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}
