import { sweepMinimums } from "@herald/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { networkRegistry } from "../networks.ts";
import { decimalToBaseUnits } from "../price.ts";
import {
  NearAccountIdSchema,
  SweepMinimumEditSchema,
  SweepMinimumSchema,
  type HeraldEnv,
  type SweepMinimum,
} from "../schemas.ts";
import type { Db } from "./db.ts";
import { readSession, type Session, type SessionStore } from "./sessions.ts";

/**
 * Herald admins, as configured: NEAR account ids separated by commas
 * (`"ops.near, alice.near"`). Unset or empty means nobody.
 */
const AdminAllowlistSchema = z
  .string()
  .optional()
  .transform((raw) =>
    (raw ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0),
  )
  .pipe(z.array(NearAccountIdSchema));

/**
 * Whether a Provider Account is a Herald admin: one of `config.admins`. An
 * allowlist that doesn't parse admits nobody, and is logged.
 */
export function isHeraldAdmin(accountId: string, config: { admins: string | undefined }): boolean {
  const admins = AdminAllowlistSchema.safeParse(config.admins);
  if (!admins.success) {
    console.error(
      JSON.stringify({
        event: "admin_allowlist_invalid",
        error: admins.error.issues[0]?.message ?? "Invalid allowlist",
      }),
    );
    return false;
  }
  return admins.data.includes(accountId);
}

/**
 * The session a token belongs to, if its Provider Account is a Herald admin
 * (see `isHeraldAdmin`). Null for anyone else, a visitor without a session
 * included. Every admin page and server function checks it.
 */
export async function readAdminSession(
  store: SessionStore,
  token: string | undefined,
  config: { admins: string | undefined },
): Promise<Session | null> {
  const session = await readSession(store, token);
  return session && isHeraldAdmin(session.accountId, config) ? session : null;
}

/** A `sweep_minimums` row, with the label of its network. */
export type SweepMinimumListing = SweepMinimum & { label: string };

/**
 * The Sweep minimum of USDC on every network of `env` that has one, in
 * Payment Option order. Each Herald environment's database holds the rows
 * of both; only `env`'s are listed.
 */
export async function listSweepMinimums(
  db: Db,
  input: { env: HeraldEnv },
): Promise<SweepMinimumListing[]> {
  const rows = (await db.select().from(sweepMinimums)).map((row) => SweepMinimumSchema.parse(row));
  return networkRegistry[input.env].flatMap((network) => {
    const row = rows.find((r) => r.network === network.caip2 && r.asset === network.usdc.address);
    return row ? [{ ...row, label: network.label }] : [];
  });
}

export type SweepMinimumUpdate =
  | { ok: true; minimum: SweepMinimumListing }
  | { ok: false; reason: "invalid" | "not_found"; message: string };

/**
 * Applies an admin's edit (see `SweepMinimumEditSchema`) to the existing
 * row of a network of `env` and its USDC, and stamps it updated now. Sweep
 * planning uses the new minimum from the next plan on. An edit that doesn't
 * validate, or names a row `env` doesn't list or Herald doesn't have,
 * changes nothing.
 */
export async function updateSweepMinimum(
  db: Db,
  input: { env: HeraldEnv; edit: unknown },
): Promise<SweepMinimumUpdate> {
  const parsed = SweepMinimumEditSchema.safeParse(input.edit);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid",
      message: parsed.error.issues[0]?.message ?? "Invalid edit.",
    };
  }
  const edit = parsed.data;
  const network = networkRegistry[input.env].find(
    (n) => n.caip2 === edit.network && n.usdc.address === edit.asset,
  );
  const notFound = {
    ok: false,
    reason: "not_found",
    message: `Herald ${input.env} has no Sweep minimum for ${edit.asset} on ${edit.network}.`,
  } as const;
  if (!network) return notFound;

  const [row] = await db
    .update(sweepMinimums)
    .set({
      minimum: decimalToBaseUnits(edit.minimum, network.usdc.decimals),
      note: edit.note,
      updatedAt: new Date(),
    })
    .where(and(eq(sweepMinimums.network, network.caip2), eq(sweepMinimums.asset, edit.asset)))
    .returning();
  if (!row) return notFound;
  return { ok: true, minimum: { ...SweepMinimumSchema.parse(row), label: network.label } };
}
