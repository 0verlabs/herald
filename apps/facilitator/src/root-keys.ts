import { checkMpcRootKeys, nearRpcMpcRootKeyReader, type HeraldEnv } from "@herald/core";

export type RootKeyStatus =
  | { ok: true }
  | { ok: false; error: "root_key_mismatch" | "root_key_check_failed"; message: string };

// How long a passing check is trusted before it runs again.
const RECHECK_AFTER_MS = 10 * 60 * 1000;

/**
 * Guards settlement on the MPC root-key check: the pinned root keys must
 * match the live signer contract, or the Receiving Addresses Herald derives
 * aren't ones anyone can sign for. Workers can't do I/O at startup, so the
 * check runs on the first settlement an isolate handles, then again every
 * ten minutes. Only a passing result is kept; a mismatch or an RPC failure
 * refuses settlement and is checked again on the next request.
 */
export function createRootKeyGuard() {
  let passedAt: number | undefined;

  return async function checkRootKeys(env: HeraldEnv, nearRpcUrl: string): Promise<RootKeyStatus> {
    if (passedAt !== undefined && Date.now() - passedAt < RECHECK_AFTER_MS) return { ok: true };
    let check;
    try {
      check = await checkMpcRootKeys(env, nearRpcMpcRootKeyReader(nearRpcUrl));
    } catch (error) {
      console.error(
        JSON.stringify({ event: "root_key_check_failed", error: String(error), nearRpcUrl }),
      );
      return {
        ok: false,
        error: "root_key_check_failed",
        message: "Herald couldn't check the MPC root keys, so it isn't settling right now.",
      };
    }
    if (!check.ok) {
      console.error(JSON.stringify({ event: "root_key_mismatch", mismatches: check.mismatches }));
      return {
        ok: false,
        error: "root_key_mismatch",
        message:
          "The MPC signer's root keys no longer match the ones Herald derives Receiving Addresses from, so Herald refuses to settle.",
      };
    }
    passedAt = Date.now();
    return { ok: true };
  };
}
