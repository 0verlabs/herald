import type { Wallet } from "@hrld/core";
import {
  AbstractSigner,
  getBigInt,
  JsonRpcProvider,
  type Provider,
  type TransactionRequest,
  type TypedDataDomain,
  type TypedDataField,
  TypedDataEncoder,
} from "ethers";
import type { Hex, TransactionSerializable } from "viem";
import type { WalletSession } from "./privy.ts";
import { toWalletAccount } from "./viem.ts";

// The 0G storage SDK speaks ethers: the flow contract it submits uploads
// through must be run by an ethers Signer. This adapter satisfies that
// interface while delegating every signature to the Privy-backed viem account,
// so ethers only prepares (nonce, gas, fees) and broadcasts transactions and
// never holds key material.
export function toEthersSigner(session: WalletSession, wallet: Wallet, rpcUrl: string) {
  return new ViemAccountSigner(toWalletAccount(session, wallet), new JsonRpcProvider(rpcUrl));
}

class ViemAccountSigner extends AbstractSigner {
  constructor(
    private readonly account: ReturnType<typeof toWalletAccount>,
    provider: Provider | null,
  ) {
    super(provider);
  }

  connect(provider: Provider | null): ViemAccountSigner {
    return new ViemAccountSigner(this.account, provider);
  }

  async getAddress(): Promise<string> {
    return this.account.address;
  }

  async signTransaction(tx: TransactionRequest): Promise<string> {
    return this.account.signTransaction(toViemTransaction(tx));
  }

  async signMessage(message: string | Uint8Array): Promise<string> {
    return this.account.signMessage({
      message: typeof message === "string" ? message : { raw: message },
    });
  }

  async signTypedData(
    domain: TypedDataDomain,
    types: Record<string, Array<TypedDataField>>,
    value: Record<string, unknown>,
  ): Promise<string> {
    // Privy validates the typed data itself; viem's generics are stricter than
    // ethers' loose TypedDataDomain, so the shape is passed through untouched.
    return this.account.signTypedData({
      domain,
      types,
      primaryType: TypedDataEncoder.getPrimaryType(types),
      message: value,
    } as Parameters<typeof this.account.signTypedData>[0]);
  }
}

// ethers hands signTransaction an already-populated transaction (nonce, gas,
// fees and chainId resolved by AbstractSigner.sendTransaction), so mapping to
// viem's serializable shape is a plain field-by-field conversion.
function toViemTransaction(tx: TransactionRequest): TransactionSerializable {
  const quantity = (value: TransactionRequest["value"]) =>
    value === null || value === undefined ? undefined : getBigInt(value);

  const base = {
    chainId: Number(getBigInt(tx.chainId ?? 0)),
    nonce: tx.nonce === null || tx.nonce === undefined ? undefined : Number(tx.nonce),
    to: typeof tx.to === "string" ? (tx.to as Hex) : undefined,
    value: quantity(tx.value),
    data: typeof tx.data === "string" ? (tx.data as Hex) : undefined,
    gas: quantity(tx.gasLimit),
  };

  if (tx.maxFeePerGas !== null && tx.maxFeePerGas !== undefined)
    return {
      ...base,
      type: "eip1559",
      maxFeePerGas: getBigInt(tx.maxFeePerGas),
      maxPriorityFeePerGas: quantity(tx.maxPriorityFeePerGas),
    };

  return { ...base, type: "legacy", gasPrice: quantity(tx.gasPrice) };
}
