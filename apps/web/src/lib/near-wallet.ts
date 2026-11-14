import { receivingAddressPaths, type HeraldEnv } from "@herald/core";
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

/** A connected NEAR wallet holding the Provider Account (`walletFor`). */
export type NearWallet = Wallet;

/**
 * Who pays a Sweep's NEAR gas with this wallet: `herald` when it declares
 * `signDelegateActions` (ADR 0010: it signs the MPC `sign` call as a
 * delegate action and Herald's relayer sends it), `provider` when it sends
 * the call itself. Read off near-connect's wallet manifest.
 */
export type NearGasPayer = "herald" | "provider";

export function nearGasPayer(wallet: Pick<Wallet, "manifest">): NearGasPayer {
  return wallet.manifest.features.signDelegateActions ? "herald" : "provider";
}

/**
 * Who pays the NEAR gas with the wallet connected now, or null if none is
 * connected yet (it's known once the Provider connects one to approve).
 * Connects nothing and asks nothing of the wallet.
 */
export async function connectedNearGasPayer(heraldEnv: HeraldEnv): Promise<NearGasPayer | null> {
  const near = await nearConnector(heraldEnv);
  try {
    return nearGasPayer(await near.wallet());
  } catch {
    return null;
  }
}

/**
 * Calls `onChange` with who pays the NEAR gas (`connectedNearGasPayer`) now
 * and each time a wallet connects or disconnects. Answers a function that
 * stops it.
 */
export function watchNearGasPayer(
  heraldEnv: HeraldEnv,
  onChange: (payer: NearGasPayer | null) => void,
): () => void {
  let stopped = false;
  const update = () =>
    void connectedNearGasPayer(heraldEnv).then((payer) => {
      if (!stopped) onChange(payer);
    });
  update();
  const near = nearConnector(heraldEnv);
  void near.then((connector) => {
    if (stopped) return;
    connector.on("wallet:signIn", update);
    connector.on("wallet:signOut", update);
  });
  return () => {
    stopped = true;
    void near.then((connector) => {
      connector.off("wallet:signIn", update);
      connector.off("wallet:signOut", update);
    });
  };
}

/**
 * Has the wallet sign the MPC `sign` call as a NEP-366 delegate action from
 * `signerId`, without sending it, and answers the signed delegate action
 * (base64 Borsh) for Herald's relayer to send (ADR 0010). One delegate
 * action holds the one `sign` call, as ADR 0008 asks of a transaction.
 */
export async function signedDelegateActionFor(
  wallet: Wallet,
  input: { heraldEnv: HeraldEnv; signerId: string; request: MpcSignRequest },
): Promise<string> {
  const answered = await wallet.signDelegateActions({
    network: input.heraldEnv,
    signerId: input.signerId,
    delegateActions: [signTransaction(input.request)],
  });
  const [signed] = Array.isArray(answered?.signedDelegateActions)
    ? answered.signedDelegateActions
    : [];
  if (typeof signed !== "string" || signed === "") {
    throw new Error("Your wallet didn't return the signed approval.");
  }
  return signed;
}

/**
 * Has the wallet sign the MPC `sign` calls of a "Sweep all" as NEP-366
 * delegate actions from `signerId`, all in one request, without sending
 * any, and answers the signed delegate actions (base64 Borsh) for Herald's
 * relayer to send, each in its own transaction (ADR 0008, ADR 0010).
 * Solana's are asked for first (`approvalOrder`): a wallet such as Meteor
 * numbers nonces in request order, and Herald relays in nonce order, so
 * Solana's, which expires soonest, is relayed first. A wallet may answer
 * fewer than asked for; Herald matches each to its Sweep by payload.
 */
export async function signedDelegateActionsFor(
  wallet: Wallet,
  input: { heraldEnv: HeraldEnv; signerId: string; requests: MpcSignRequest[] },
): Promise<string[]> {
  const answered = await wallet.signDelegateActions({
    network: input.heraldEnv,
    signerId: input.signerId,
    delegateActions: approvalOrder(input.requests).flatMap((index) => {
      const request = input.requests[index];
      return request ? [signTransaction(request)] : [];
    }),
  });
  const signed: unknown[] = Array.isArray(answered?.signedDelegateActions)
    ? answered.signedDelegateActions
    : [];
  return signed.filter((s): s is string => typeof s === "string" && s !== "");
}

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
 * The order to ask for approvals one at a time, or for delegate actions in
 * one request (`signedDelegateActionsFor`): Solana's first, since its
 * transaction expires within about a minute of planning, then the rest as
 * planned. A NEAR Sweep's delegate action, like an EVM authorization, stays
 * valid for about 10 minutes (less if its 1Click quote expires sooner), so
 * it can wait behind Solana's.
 */
function approvalOrder(requests: MpcSignRequest[]): number[] {
  const indexes = requests.map((_, index) => index);
  const isSolana = (index: number) =>
    requests[index]?.args.request.path === receivingAddressPaths.solana.path;
  return [...indexes.filter(isSolana), ...indexes.filter((index) => !isSolana(index))];
}

/**
 * Has the wallet send each MPC `sign` call in its own NEAR transaction: the
 * MPC network only answers a `sign` call alone in its transaction, so calls
 * are never batched into one. A wallet that sends several transactions at
 * once asks for one approval; any other asks once per call, in
 * `approvalOrder`. Calls sent before the wallet stops keep their hashes.
 */
export async function signEachInOwnTransaction(
  wallet: Wallet,
  input: { heraldEnv: HeraldEnv; signerId: string; requests: MpcSignRequest[] },
): Promise<SignedCalls> {
  const { requests } = input;
  const hashes: Array<string | null> = requests.map(() => null);

  if (!wallet.manifest.features.signAndSendTransactions) {
    const unsent = requests.map(() => true);
    for (const index of approvalOrder(requests)) {
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
