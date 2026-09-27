import fs from "node:fs/promises";
import path from "node:path";
import { Indexer, ZgFile } from "@0gfoundation/0g-storage-ts-sdk";
import { type EvmChain, evmChainSchema, viemChainByChain } from "@hrld/core";
import pc from "picocolors";
import { z } from "zod";
import { zodCommand } from "zod-commander";
import { toEthersSigner } from "../lib/ethers.ts";
import { openSession, requireUserId, requireWallet } from "../lib/session.ts";
import {
  appendUploads,
  indexerRpcByChain,
  readUploads,
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
  opts: { chain: evmChainOpt },
  action: async (args, opts) => {
    const json = isJson(upload);

    const result = await uploadPath(opts.chain, args.path, json).catch((error: Error) => error);
    if (result instanceof Error) return err(result)(json);

    ok(
      result.records
        .map((record) =>
          fields([
            ["Name", record.name],
            ["Root Hash", pc.cyan(record.rootHash)],
            ["Tx Hash", pc.cyan(record.txHash)],
            ["Size", formatBytes(record.size)],
          ]),
        )
        .join("\n\n"),
      result,
    )(json);
  },
});

async function uploadPath(chain: EvmChain, inputPath: string, json: boolean) {
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

    const size = (await fs.stat(filePath)).size;
    const file = await ZgFile.fromFilePath(filePath);
    const [tx, uploadErr] = await withQuietConsole(() =>
      indexer.upload(file, rpcUrl, signer, {
        onProgress: (message: string) => progress(json, message),
      }),
    );
    await file.close();
    if (uploadErr !== null)
      throw new CliError(
        "STORAGE_UPLOAD_FAILED",
        `Upload failed for ${name}: ${uploadErr.message}`,
        "Check the wallet's 0G balance covers the storage fee and gas, then retry.",
      );

    const uploadedAt = new Date().toISOString();
    records.push(
      "rootHash" in tx
        ? { name, size, rootHash: tx.rootHash, txHash: tx.txHash, uploadedAt }
        : {
            name,
            size,
            rootHash: tx.rootHashes[0] ?? "",
            rootHashes: tx.rootHashes,
            txHash: tx.txHashes[0] ?? "",
            uploadedAt,
          },
    );
  }

  await appendUploads(userId, records);
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
      ]),
      result,
    )(json);
  },
});

// Downloads are public: any file on the network is retrievable by root hash,
// so no login or wallet is required.
async function downloadFile(
  chain: EvmChain,
  rootHash: string,
  opts: { output?: string; proof: boolean },
  json: boolean,
) {
  const outputPath = path.resolve(opts.output ?? rootHash);
  progress(json, `Downloading ${rootHash}...`);

  const downloadErr = await withQuietConsole(() =>
    new Indexer(indexerRpcByChain[chain]).download(rootHash, outputPath, opts.proof),
  );
  if (downloadErr !== null)
    throw new CliError(
      "STORAGE_DOWNLOAD_FAILED",
      downloadErr.message,
      "Verify the root hash and that the file is finalized on the network.",
    );

  return {
    rootHash,
    path: outputPath,
    size: (await fs.stat(outputPath)).size,
    verified: opts.proof,
  };
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
              `${formatBytes(record.size)}, ${record.uploadedAt.slice(0, 10)}`,
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
  .addCommand(list);
