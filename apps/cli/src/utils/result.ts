import type { Command } from "commander";
import pc from "picocolors";

export function isJson(cmd: Command): boolean {
  return cmd.optsWithGlobals().json === true;
}

export function toStringOutput<T>(value: T): string {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) return JSON.stringify(value, null, 2);

  return String(value);
}

export function ok<T extends Record<string, unknown>>(value: T, json: boolean): void {
  if (!json) {
    for (const key in value) {
      const display = toStringOutput(value[key]);
      console.log(`${key}: ${display}`);
    }
    return;
  }

  console.log(JSON.stringify(value, null, 2));
}

export function err(error: string | Error, json: boolean): void {
  const message = error instanceof Error ? error.message : error;

  if (!json) {
    console.error(pc.red(message));
    process.exitCode = 1;
    return;
  }

  console.error(JSON.stringify({ error: message }, null, 2));
  process.exitCode = 1;
}
