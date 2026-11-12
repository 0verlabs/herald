import type { HeraldEnv } from "@herald/core";
import type { MpcSignRequest } from "@herald/core/server";
import type { NearConnector } from "@hot-labs/near-connect";

let connector: Promise<NearConnector> | undefined;

/**
 * Herald's NEAR wallet connector (`@hot-labs/near-connect`), created in the
 * browser on first use: it needs `window` and IndexedDB, so it never loads
 * during SSR. It offers only wallets on the Herald environment's NEAR
 * network that can sign messages (sign-in) and send transactions (Sweeps).
 */
export function nearConnector(network: HeraldEnv): Promise<NearConnector> {
  connector ??= import("@hot-labs/near-connect").then(async ({ NearConnector }) => {
    const features = { signMessage: true, signAndSendTransaction: true };
    const created = new NearConnector({
      network,
      features:
        network === "mainnet" ? { ...features, mainnet: true } : { ...features, testnet: true },
    });
    await created.whenManifestLoaded;
    return created;
  });
  return connector;
}

/** Decodes a base64 string, such as a sign-in nonce, to bytes. */
export function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

/**
 * The connected NEAR wallet, connecting one if none is. Throws unless it
 * holds `accountId`: a Sweep signature derives from the signing account, so
 * it must be the Provider Account signed in to the dashboard.
 */
export async function walletFor(heraldEnv: HeraldEnv, accountId: string) {
  const near = await nearConnector(heraldEnv);
  const wallet = await near.wallet().catch(() => near.connect());
  const accounts = await wallet.getAccounts({ network: heraldEnv });
  if (!accounts.some((account) => account.accountId === accountId)) {
    const connected = accounts.map((account) => account.accountId).join(", ") || "no account";
    throw new Error(
      `Your wallet is connected to ${connected}. Connect ${accountId}, the Provider Account you signed in with.`,
    );
  }
  return wallet;
}

type Wallet = Awaited<ReturnType<typeof walletFor>>;

/** The NEAR transaction hash in a wallet's outcome, or null if it gave none. */
function txHashOf(outcome: unknown): string | null {
  const reported = outcome as {
    transaction_outcome?: { id?: unknown };
    transaction?: { hash?: unknown };
  } | null;
  const hash = reported?.transaction_outcome?.id ?? reported?.transaction?.hash;
  return typeof hash === "string" ? hash : null;
}

/** The hex payload a `sign` call asks the MPC signer to sign. */
function payloadOf(args: Pick<MpcSignRequest["args"], "request">): string {
  const payload = args.request.payload_v2;
  return "Ecdsa" in payload ? payload.Ecdsa : payload.Eddsa;
}

/** The payload a wallet outcome's `sign` call asked for, to match it to its Sweep. */
function signedPayloadOf(outcome: unknown): string | null {
  const actions = (outcome as { transaction?: { actions?: unknown[] } } | null)?.transaction
    ?.actions;
  const call = (actions?.[0] as { FunctionCall?: { args?: unknown } } | undefined)?.FunctionCall;
  if (typeof call?.args !== "string") return null;
  try {
    return payloadOf(JSON.parse(atob(call.args)) as MpcSignRequest["args"]);
  } catch {
    return null;
  }
}

/** The NEAR transaction that sends one `sign` call, alone, to the MPC signer. */
function signTransaction(request: MpcSignRequest) {
  return {
    receiverId: request.contractId,
    actions: [
      {
        type: "FunctionCall" as const,
        params: {
          methodName: request.methodName,
          args: request.args,
          gas: request.gas,
          deposit: request.deposit,
        },
      },
    ],
  };
}

/** What the wallet did with each `sign` call, in the order they were asked for. */
export type SignedCalls = {
  /** Each call's NEAR transaction hash, or null if the wallet gave none. */
  hashes: Array<string | null>;
  /** The calls the wallet certainly never sent, so their Sweeps can be discarded. */
  unsent: boolean[];
  /** Why the wallet stopped before answering every call, if it did. */
  error: unknown;
};

/**
 * Has the wallet send each MPC `sign` call in its own NEAR transaction: the
 * MPC network only answers a `sign` call alone in its transaction, so calls
 * are never batched into one. A wallet that sends several transactions at
 * once asks for one approval; any other asks once per call, Solana's first,
 * since its transaction expires within about a minute. Calls sent before
 * the wallet stops keep their hashes.
 */
export async function signEachInOwnTransaction(
  wallet: Wallet,
  input: { heraldEnv: HeraldEnv; signerId: string; requests: MpcSignRequest[] },
): Promise<SignedCalls> {
  const { requests } = input;
  const hashes: Array<string | null> = requests.map(() => null);

  if (!wallet.manifest.features.signAndSendTransactions) {
    const unsent = requests.map(() => true);
    const order = requests
      .map((request, index) => ({ index, solana: "Eddsa" in request.args.request.payload_v2 }))
      .sort((a, b) => Number(b.solana) - Number(a.solana));
    for (const { index } of order) {
      const request = requests[index];
      if (!request) continue;
      try {
        unsent[index] = false;
        const outcome = await wallet.signAndSendTransaction({
          network: input.heraldEnv,
          signerId: input.signerId,
          ...signTransaction(request),
        });
        hashes[index] = txHashOf(outcome);
      } catch (error) {
        return { hashes, unsent, error };
      }
    }
    return { hashes, unsent, error: null };
  }

  let outcomes: unknown[];
  try {
    const answered = await wallet.signAndSendTransactions({
      network: input.heraldEnv,
      signerId: input.signerId,
      transactions: requests.map(signTransaction),
    });
    outcomes = Array.isArray(answered) ? answered : [];
  } catch (error) {
    // Some transactions may have gone out: none is safe to discard.
    return { hashes, unsent: requests.map(() => false), error };
  }
  // Match each outcome to its Sweep by the payload it signed. Only outcomes
  // that don't show the call are trusted to keep the order: handing a
  // Sweep another one's hash would fail it.
  const payloads = outcomes.map(signedPayloadOf);
  requests.forEach((request, index) => {
    const at = payloads.every((p) => p === null)
      ? index
      : payloads.indexOf(payloadOf(request.args));
    hashes[index] = at === -1 ? null : txHashOf(outcomes[at]);
  });
  return { hashes, unsent: requests.map(() => false), error: null };
}
