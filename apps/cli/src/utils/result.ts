import type { Command } from "commander";
import pc from "picocolors";
import { CliError } from "./errors.ts";

export function isJson(cmd: Command): boolean {
  return cmd.optsWithGlobals().json === true;
}

/**
 * Declares --json on a command and every subcommand below it. Root options
 * stop at the first subcommand (positional options), so each subcommand must
 * accept the flag itself; isJson() merges all levels via optsWithGlobals().
 */
export function addJsonOption(command: Command): void {
  command.option("--json", "Output results as JSON");
  command.commands.forEach(addJsonOption);
}

export function toStringOutput<T>(value: T): string {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) return JSON.stringify(value, null, 2);

  return String(value);
}

/**
 * Renders label/value pairs as aligned lines with dimmed labels, e.g.:
 * ```
 * Address    0xabc…
 * Chain      0g
 * ```
 */
export function fields(entries: Array<[label: string, value: unknown]>): string {
  const width = Math.max(...entries.map(([label]) => label.length));
  return entries
    .map(([label, value]) => `${pc.dim(`${label.padEnd(width)}`)}   ${toStringOutput(value)}`)
    .join("\n");
}

/** A short, colored confirmation line, e.g. "✓ Logged in". */
export function success(message: string): string {
  return pc.green(`✓ ${message}`);
}

/** Collapses whitespace and caps `text` at `max` characters with an ellipsis. */
export function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

/** Shortens a 0x address to its first and last characters, e.g. 0x1234…abcd. */
export function shortAddress(address: string): string {
  return address.length <= 12 ? address : `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Prints one of two representations once the caller knows whether `--json` was passed. */
export type Result = (json: boolean) => void;

/**
 * Builds a deferred success output. `stdout` is printed as-is for humans;
 * build it with `fields()` or `success()`, or write it by hand for anything
 * more custom (QR codes, multi-section layouts). `payload` is what gets
 * serialized for `--json`.
 */
export function ok(stdout: string, payload: unknown): Result {
  return (isJson) => console.log(isJson ? JSON.stringify(payload, null, 2) : stdout);
}

/** Builds a deferred error output and sets `process.exitCode`. */
export function err(error: string | Error, payload?: unknown): Result {
  const message = error instanceof Error ? error.message : error;
  const code = error instanceof CliError ? error.code : undefined;
  const recovery = error instanceof CliError ? error.recovery : undefined;

  return (isJson) => {
    process.exitCode = 1;

    if (!isJson) {
      console.error(code ? `${pc.red(message)} ${pc.dim(`[${code}]`)}` : pc.red(message));
      if (recovery) console.error(pc.yellow(`→ ${recovery}`));
      return;
    }

    console.error(
      JSON.stringify(
        payload ?? { error: message, ...(code && { code }), ...(recovery && { recovery }) },
        null,
        2,
      ),
    );
  };
}
