import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { EvmChain } from "@hrld/core";
import { getPassword, setPassword } from "cross-keychain";
import { z } from "zod";

// 0G Storage runs two independent networks (turbo and standard) with separate
// indexers; Herald uses turbo, the endpoint published in the 0G mainnet docs.
export const indexerRpcByChain = {
  "0g": "https://indexer-storage-turbo.0g.ai",
} as const satisfies Record<EvmChain, string>;

const STORAGE_DIR = path.join(os.homedir(), ".hrld", "storage");

const uploadRecordSchema = z.object({
  name: z.string(),
  size: z.number(),
  rootHash: z.string(),
  // Present only when the SDK split a large file into fragments; downloading
  // such a file needs every fragment root in order.
  rootHashes: z.array(z.string()).optional(),
  txHash: z.string(),
  uploadedAt: z.string(),
  encrypted: z.boolean().optional(),
});

export type UploadRecord = z.infer<typeof uploadRecordSchema>;

const indexSchema = z.array(uploadRecordSchema);

// Uploads are indexed per user at ~/.hrld/storage/<user_id>.json so `storage
// list` works offline; the network itself only knows root hashes.
function indexPath(userId: string) {
  return path.join(STORAGE_DIR, `${userId}.json`);
}

export async function readUploads(userId: string): Promise<UploadRecord[]> {
  return fs
    .readFile(indexPath(userId), "utf8")
    .then((raw) => indexSchema.parse(JSON.parse(raw)))
    .catch(() => []);
}

export async function appendUploads(userId: string, records: UploadRecord[]): Promise<void> {
  const existing = await readUploads(userId);
  await fs.mkdir(STORAGE_DIR, { recursive: true });
  await fs.writeFile(indexPath(userId), `${JSON.stringify([...existing, ...records], null, 2)}\n`);
}

// AES keys are irrecoverable (the network only ever sees ciphertext), so they
// stay out of the plain-JSON index and live in the OS keychain instead: one
// entry per user holding a rootHash → key map, mirroring how credentials.ts
// stores tokens under the same service.
const KEYCHAIN_SERVICE = "hrld-cli";

const storageKeysSchema = z.record(z.string(), z.string());

export async function readStorageKeys(userId: string): Promise<Record<string, string>> {
  const raw = await getPassword(KEYCHAIN_SERVICE, `storage-keys-${userId}`).catch(() => null);
  if (!raw) return {};

  return Promise.resolve(raw)
    .then((value) => storageKeysSchema.parse(JSON.parse(value)))
    .catch(() => ({}));
}

export async function saveStorageKeys(
  userId: string,
  entries: Record<string, string>,
): Promise<void> {
  const merged = { ...(await readStorageKeys(userId)), ...entries };
  await setPassword(KEYCHAIN_SERVICE, `storage-keys-${userId}`, JSON.stringify(merged));
}

// The 0G SDK narrates its internals with console.log/error, which would
// corrupt --json output and drown the CLI's own reporting; both are silenced
// for the duration of an SDK call and progress surfaces via onProgress.
export async function withQuietConsole<T>(run: () => Promise<T>): Promise<T> {
  const log = console.log;
  const error = console.error;
  console.log = () => {};
  console.error = () => {};

  return run().finally(() => {
    console.log = log;
    console.error = error;
  });
}
