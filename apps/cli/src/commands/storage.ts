import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  ECIES_HEADER_SIZE,
  ECIES_VERSION,
  Indexer,
  SYMMETRIC_HEADER_SIZE,
  SYMMETRIC_VERSION,
  ZgFile,
} from "@0gfoundation/0g-storage-ts-sdk";
import { type EvmChain, evmChainSchema, viemChainByChain } from "@hrld/core";
import pc from "picocolors";
import { z } from "zod";
import { zodCommand } from "zod-commander";
import { toEthersSigner } from "../lib/ethers.ts";
import { openSession, requireUserId, requireWallet } from "../lib/session.ts";
import {
  appendUploads,
  indexerRpcByChain,
  readStorageKeys,
  readUploads,
  saveStorageKeys,
  type UploadRecord,
  withQuietConsole,
} from "../lib/storage.ts";
import { CliError } from "../utils/errors.ts";
import { err, fields, isJson, ok } from "../utils/result.ts";

// Only 0G is supported today, but every command takes `--chain` so adding a
// network is a change to the enum in @hrld/core rather than to each command.
const evmChainOpt = evmChainSchema.prefault("0g").describe("c;Chain to operate on");

const upload = zodCommand({
  name: "upload",
  description: "Upload a file or directory to 0G Storage with the active wallet",
  args: {
    path: z.string().describe("File to upload, or a directory to upload every file inside"),
  },
  opts: {
    chain: evmChainOpt,
    encrypt: z
      .boolean()
      .prefault(false)
      .describe("e;Encrypt with AES-256 before upload, generating a fresh key per file"),
  },
  action: async (args, opts) => {
    const json = isJson(upload);

    const result = await uploadPath(opts.chain, args.path, opts.encrypt, json).catch(
      (error: Error) => error,
    );
    if (result instanceof Error) return err(result)(json);

    const blocks = result.records.map((record) =>
      fields([
        ["Name", record.name],
        ["Root Hash", pc.cyan(record.rootHash)],
        ["Tx Hash", pc.cyan(record.txHash)],
        ["Size", formatBytes(record.size)],
      ]),
    );
    // The key is deliberately not shown: it lives in the OS keychain, and
    // printing it would leak an irrecoverable secret into scrollback and logs.
    const keyNote = opts.encrypt
      ? `\n\n${pc.yellow("Keys are saved to this machine's keychain; downloads by this account decrypt automatically. To share a file, run `hrld storage key <root_hash>`.")}`
      : "";

    ok(`${blocks.join("\n\n")}${keyNote}`, result)(json);
  },
});

async function uploadPath(chain: EvmChain, inputPath: string, encrypt: boolean, json: boolean) {
  const userId = await requireUserId();
  const session = await openSession();
  const wallet = requireWallet(session, chain);
  const files = await collectFiles(inputPath);

  const rpcUrl = viemChainByChain[chain].rpcUrls.default.http[0];
  const signer = toEthersSigner(session, wallet, rpcUrl);
  const indexer = new Indexer(indexerRpcByChain[chain]);
  const root = path.dirname(path.resolve(inputPath));

  const records: UploadRecord[] = [];
  for (const filePath of files) {
    const name = path.relative(root, filePath);
    progress(json, `Uploading ${name}...`);

    const key = encrypt ? randomBytes(32) : undefined;
    const size = (await fs.stat(filePath)).size;
    const file = await ZgFile.fromFilePath(filePath);
    const [tx, uploadErr] = await withQuietConsole(() =>
      indexer.upload(file, rpcUrl, signer, {
        onProgress: (message: string) => progress(json, message),
        ...(key && { encryption: { type: "aes256", key } }),
      }),
    );
    await file.close();
    if (uploadErr !== null)
      throw new CliError(
        "STORAGE_UPLOAD_FAILED",
        `Upload failed for ${name}: ${uploadErr.message}`,
        "Check the wallet's 0G balance covers the storage fee and gas, then retry.",
      );

    const record: UploadRecord = {
      name,
      size,
      uploadedAt: new Date().toISOString(),
      ...(key && { encrypted: true }),
      ...("rootHash" in tx
        ? { rootHash: tx.rootHash, txHash: tx.txHash }
        : {
            rootHash: tx.rootHashes[0] ?? "",
            rootHashes: tx.rootHashes,
            txHash: tx.txHashes[0] ?? "",
          }),
    };

    // Persisted per file, not after the loop: the key is the only way to ever
    // decrypt, so a failure on a later file must not lose earlier ones. The
    // key itself goes to the OS keychain, never the plain-JSON index.
    await appendUploads(userId, [record]);
    if (key) await saveStorageKeys(userId, { [record.rootHash]: `0x${key.toString("hex")}` });

    records.push(record);
  }

  return { chain, address: wallet.address, records };
}

async function collectFiles(inputPath: string): Promise<string[]> {
  const resolved = path.resolve(inputPath);
  const stats = await fs.stat(resolved).catch(() => null);
  if (!stats)
    throw new CliError("STORAGE_PATH_NOT_FOUND", `No such file or directory: ${inputPath}`);
  if (stats.isFile()) return [resolved];

  const entries = await fs.readdir(resolved, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
  if (files.length === 0)
    throw new CliError("STORAGE_PATH_NOT_FOUND", `Directory is empty: ${inputPath}`);

  return files;
}

const download = zodCommand({
  name: "download",
  description: "Download any file from 0G Storage by its merkle root hash",
  args: {
    rootHash: z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/, "Expected a 0x-prefixed root hash")
      .describe("Merkle root hash of the file"),
  },
  opts: {
    chain: evmChainOpt,
    output: z
      .string()
      .optional()
      .describe("o;Output path; defaults to the root hash in the current directory"),
    proof: z.boolean().prefault(false).describe("p;Verify merkle proofs while downloading"),
    key: z
      .string()
      .regex(/^(0x)?[0-9a-fA-F]{64}$/, "Expected a 32-byte hex AES-256 key")
      .optional()
      .describe("k;AES-256 key to decrypt with; defaults to a key saved by this account"),
    raw: z
      .boolean()
      .prefault(false)
      .describe("r;Save the file exactly as stored on the network, skipping decryption"),
  },
  action: async (args, opts) => {
    const json = isJson(download);

    const result = await downloadFile(opts.chain, args.rootHash, opts, json).catch(
      (error: Error) => error,
    );
    if (result instanceof Error) return err(result)(json);

    ok(
      fields([
        ["Root Hash", pc.cyan(result.rootHash)],
        ["Saved To", result.path],
        ["Size", formatBytes(result.size)],
        ["Verified", result.verified ? "yes" : "no"],
        ["Decrypted", result.decrypted ? "yes" : "no"],
      ]),
      result,
    )(json);
  },
});

// Downloads are public: any file on the network is retrievable by root hash,
// so no login or wallet is required. A key saved by this account is picked up
// automatically when available; encryption is otherwise the caller's call via
// --key/--raw, because the on-network header has no magic bytes to detect it
// reliably.
async function downloadFile(
  chain: EvmChain,
  rootHash: string,
  opts: { output?: string; proof: boolean; key?: string; raw: boolean },
  json: boolean,
) {
  if (opts.key && opts.raw)
    throw new CliError("FLAG_CONFLICT", "--key and --raw cannot be combined.");

  const outputPath = path.resolve(opts.output ?? rootHash);
  const indexer = new Indexer(indexerRpcByChain[chain]);
  const key = opts.raw ? undefined : (opts.key ?? (await savedKey(rootHash)));
  progress(json, `Downloading ${rootHash}...`);

  if (key) {
    // Decryption only works through downloadToBlob, which buffers the whole
    // file in memory; acceptable for the file sizes the CLI deals in.
    const [blob, downloadErr] = await withQuietConsole(() =>
      indexer.downloadToBlob(rootHash, { proof: opts.proof, decryption: { symmetricKey: key } }),
    );
    if (downloadErr !== null)
      throw new CliError(
        "STORAGE_DOWNLOAD_FAILED",
        downloadErr.message,
        "Verify the root hash and that the file is finalized on the network.",
      );

    await fs.writeFile(outputPath, Buffer.from(await blob.arrayBuffer()));
    return { rootHash, path: outputPath, size: blob.size, verified: opts.proof, decrypted: true };
  }

  const downloadErr = await withQuietConsole(() =>
    indexer.download(rootHash, outputPath, opts.proof),
  );
  if (downloadErr !== null)
    throw new CliError(
      "STORAGE_DOWNLOAD_FAILED",
      downloadErr.message,
      "Verify the root hash and that the file is finalized on the network.",
    );

  if (!opts.raw && (await hasEncryptionHeader(outputPath)))
    process.stderr.write(
      pc.yellow(
        "The file starts with a 0G encryption header and is likely ciphertext. Re-run with --key <hex> to decrypt, or --raw to silence this warning.\n",
      ),
    );

  return {
    rootHash,
    path: outputPath,
    size: (await fs.stat(outputPath)).size,
    verified: opts.proof,
    decrypted: false,
  };
}

// A saved key is a best-effort convenience: downloads must keep working
// logged out and for files this account never uploaded.
async function savedKey(rootHash: string): Promise<string | undefined> {
  const userId = await requireUserId().catch(() => null);
  if (!userId) return undefined;

  return (await readStorageKeys(userId))[rootHash];
}

// The header carries no magic bytes, only a version byte, so this can false-
// positive on plaintext that happens to start with 0x01/0x02 — which is why
// it powers a warning rather than a hard failure.
async function hasEncryptionHeader(filePath: string): Promise<boolean> {
  const handle = await fs.open(filePath, "r");
  const { buffer, bytesRead } = await handle.read(
    Buffer.alloc(ECIES_HEADER_SIZE),
    0,
    ECIES_HEADER_SIZE,
    0,
  );
  await handle.close();

  if (buffer[0] === SYMMETRIC_VERSION) return bytesRead >= SYMMETRIC_HEADER_SIZE;
  return buffer[0] === ECIES_VERSION && bytesRead >= ECIES_HEADER_SIZE;
}

const list = zodCommand({
  name: "list",
  description: "List files uploaded to 0G Storage by the current account",
  action: async () => {
    const json = isJson(list);

    const result = await listUploads().catch((error: Error) => error);
    if (result instanceof Error) return err(result)(json);
    if (result.uploads.length === 0)
      return ok(pc.dim("No uploads yet. Run `hrld storage upload <path>`."), result)(json);

    ok(
      result.uploads
        .map(
          (record) =>
            `${pc.cyan(record.rootHash)}  ${record.name}  ${pc.dim(
              `${formatBytes(record.size)}, ${record.uploadedAt.slice(0, 10)}${record.encrypted ? ", encrypted" : ""}`,
            )}`,
        )
        .join("\n"),
      result,
    )(json);
  },
});

async function listUploads() {
  const userId = await requireUserId();
  return { userId, uploads: await readUploads(userId) };
}

const key = zodCommand({
  name: "key",
  description: "Show the saved encryption key for a file uploaded with --encrypt",
  args: {
    rootHash: z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/, "Expected a 0x-prefixed root hash")
      .describe("Merkle root hash of the encrypted file"),
  },
  action: async (args) => {
    const json = isJson(key);

    const result = await readKey(args.rootHash).catch((error: Error) => error);
    if (result instanceof Error) return err(result)(json);

    ok(
      fields([
        ["Root Hash", pc.cyan(result.rootHash)],
        ["Key", pc.cyan(result.key)],
      ]),
      result,
    )(json);
  },
});

async function readKey(rootHash: string) {
  const userId = await requireUserId();
  const saved = (await readStorageKeys(userId))[rootHash];
  if (!saved)
    throw new CliError(
      "STORAGE_KEY_NOT_FOUND",
      "No encryption key saved for this root hash.",
      "Keys are machine-local: only files uploaded with --encrypt by this account on this machine have one.",
    );

  return { rootHash, key: saved };
}

function progress(json: boolean, message: string) {
  // Progress goes to stderr so stdout stays parseable in both output modes.
  if (!json) process.stderr.write(pc.dim(`${message}\n`));
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  const exponent = Math.min(Math.floor(Math.log2(size) / 10), units.length);
  return `${(size / 2 ** (10 * exponent)).toFixed(1)} ${units[exponent - 1]}`;
}

export const storage = zodCommand({
  name: "storage",
  description: "Store and retrieve files on 0G Storage",
})
  .addCommand(upload)
  .addCommand(download)
  .addCommand(list)
  .addCommand(key);
