import { base58 } from "@scure/base";
import { z } from "zod";
import {
  decodeSignedNearDelegate,
  nearDelegateSignatureValid,
  type DecodedNearDelegate,
} from "./near-protocol.ts";

// A sponsored Sweep (ADR 0010): the Provider's wallet signs a NEP-366
// delegate action from the Provider Account holding the Sweep's one MPC
// `sign` call, and Herald's NEAR relayer sends it in a transaction of its
// own, paying the gas and the 1 yoctoNEAR deposit. The Provider Account is
// still the `sign` caller, so the signature is still its Receiving
// Address's. ADR 0008's one `sign` per NEAR transaction holds: each
// delegate action holds one, and goes in its own relayer transaction.
//
// `readSponsoredSign` is the check both sides make. Core (`relaySponsoredSweep`)
// also matches the sender and the request to the planned Sweep; the NEAR
// chain queue, holding the relayer key, makes it again on its own before
// it pays for anything.

/**
 * The most gas Herald's relayer attaches for a sponsored `sign` call. Herald
 * asks for `MPC_SIGN_GAS` (50 Tgas); a wallet that adds some still fits.
 * Unused gas comes back to the relayer, so this bounds the gas Herald
 * prepays, not what it pays: about 0.00095 NEAR per `sign` (#46).
 */
export const SPONSORED_SIGN_MAX_GAS = 100_000_000_000_000n;

const HexSchema = z.string().regex(/^[0-9a-fA-F]+$/);

/** The `sign` call's arguments, exactly as Herald plans them (`MpcSignRequest`). */
const SignArgsSchema = z.strictObject({
  request: z.strictObject({
    payload_v2: z.union([
      z.strictObject({ Ecdsa: HexSchema }),
      z.strictObject({ Eddsa: HexSchema }),
    ]),
    path: z.string(),
    domain_id: z.number().int().nonnegative(),
  }),
});

/** What a sponsored `sign` call asks the MPC signer: `MpcSignRequest["args"]["request"]`. */
export type SponsoredSignRequest = z.infer<typeof SignArgsSchema>["request"];

/**
 * A signed delegate action holding one MPC `sign` call, as `readSponsoredSign`
 * read it: from `senderId` with its key `publicKey` (`ed25519:…`), landing
 * with `nonce` up to block `maxBlockHeight`, attaching `gas`.
 */
export type SponsoredSign = {
  signedDelegateAction: string;
  senderId: string;
  publicKey: string;
  nonce: bigint;
  maxBlockHeight: bigint;
  gas: bigint;
  request: SponsoredSignRequest;
};

/**
 * Reads a signed delegate action (base64 Borsh) as a sponsored MPC `sign`
 * call, or says why Herald won't relay it as one: it must decode, go to
 * `mpcSigner`, hold exactly one function call, `sign`, attaching exactly 1
 * yoctoNEAR and at most `SPONSORED_SIGN_MAX_GAS`, with arguments shaped
 * like Herald's `MpcSignRequest`, and be signed by its own key. Who sent it
 * and what it asks to sign are the caller's to check.
 */
export function readSponsoredSign(
  signedDelegateAction: string,
  mpcSigner: string,
): { ok: true; sign: SponsoredSign } | { ok: false; message: string } {
  const refuse = (why: string) => ({
    ok: false as const,
    message: `Herald won't relay it: ${why}.`,
  });
  let delegate: DecodedNearDelegate;
  try {
    delegate = decodeSignedNearDelegate(signedDelegateAction);
  } catch (error) {
    return refuse(
      `it isn't a signed delegate action holding function calls (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  if (delegate.receiverId !== mpcSigner) {
    return refuse(`it calls ${delegate.receiverId}, not the MPC signer ${mpcSigner}`);
  }
  const [call, ...more] = delegate.calls;
  if (!call || more.length > 0) {
    return refuse(`it holds ${delegate.calls.length} actions, not exactly one sign call`);
  }
  if (call.methodName !== "sign") return refuse(`it calls ${call.methodName}, not sign`);
  if (call.deposit !== 1n) {
    return refuse(`its sign call attaches ${call.deposit} yoctoNEAR, not exactly 1`);
  }
  if (call.gas > SPONSORED_SIGN_MAX_GAS) {
    return refuse(`its sign call asks for ${call.gas} gas, more than ${SPONSORED_SIGN_MAX_GAS}`);
  }
  let args: z.infer<typeof SignArgsSchema>;
  try {
    args = SignArgsSchema.parse(JSON.parse(new TextDecoder().decode(call.args)));
  } catch {
    return refuse("its sign arguments aren't a payload, a path and a domain");
  }
  if (!nearDelegateSignatureValid(delegate)) {
    return refuse("its signature isn't its key's");
  }
  return {
    ok: true,
    sign: {
      signedDelegateAction,
      senderId: delegate.senderId,
      publicKey: `ed25519:${base58.encode(delegate.publicKey)}`,
      nonce: delegate.nonce,
      maxBlockHeight: delegate.maxBlockHeight,
      gas: call.gas,
      request: args.request,
    },
  };
}
