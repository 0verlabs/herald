import { SYSTEM_PROGRAM_ADDRESS, usdcTokenAccount } from "@herald/core/server";
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  AssociatedTokenInstruction,
  identifyAssociatedTokenInstruction,
  identifyTokenInstruction,
  parseCreateAssociatedTokenIdempotentInstruction,
  parseTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
  TokenInstruction,
} from "@solana-program/token";
import {
  getCompiledTransactionMessageDecoder,
  getInstructionsFromCompiledTransactionMessage,
  getPublicKeyFromAddress,
  verifySignature,
  type Address,
  type Transaction,
} from "@solana/kit";

type Instruction = ReturnType<typeof getInstructionsFromCompiledTransactionMessage>[number];

/**
 * Why a transaction isn't a Sweep the gas wallet may pay for, or null if it
 * is one. A Sweep has two signers, the gas wallet (`feePayer`, first) and a
 * Receiving Address, which has signed it already; the gas wallet hasn't.
 * Its instructions are exactly:
 *
 * 1. Optionally, creating the destination's USDC token account
 *    (idempotent), with the gas wallet paying the rent.
 * 2. A USDC `TransferChecked` out of the Receiving Address's USDC token
 *    account, authorized by the Receiving Address.
 *
 * The gas wallet appears nowhere else, so signing as fee payer spends at
 * most the fee and one token account's rent.
 */
export async function sweepTransactionProblem(
  transaction: Transaction,
  feePayer: Address,
  usdc: Address,
): Promise<string | null> {
  const compiled = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  if (compiled.staticAccounts[0] !== feePayer) {
    return `The fee payer must be Herald's gas wallet, ${feePayer}`;
  }
  if (compiled.header.numSignerAccounts !== 2) {
    return "A Sweep has two signers: Herald's gas wallet and the Receiving Address";
  }
  if ("addressTableLookups" in compiled && (compiled.addressTableLookups?.length ?? 0) > 0) {
    return "A Sweep loads no address lookup tables";
  }
  const owner = compiled.staticAccounts[1];
  if (!owner) return "A Sweep has two signers: Herald's gas wallet and the Receiving Address";

  const instructions = getInstructionsFromCompiledTransactionMessage(compiled);
  const transfer = instructions.at(-1);
  if (!transfer || instructions.length > 2) {
    return "A Sweep is one USDC transfer, after at most one token account creation";
  }
  const transferProblem = await transferCheckedProblem(transfer, owner, usdc);
  if (transferProblem) return transferProblem;
  if (instructions.length === 2) {
    const createProblem = await tokenAccountCreationProblem(
      instructions[0]!,
      feePayer,
      usdc,
      parseTransferCheckedInstruction(transfer as never).accounts.destination.address,
    );
    if (createProblem) return createProblem;
  }

  if (transaction.signatures[feePayer]) return "Herald's gas wallet has already signed it";
  const ownerSignature = transaction.signatures[owner];
  if (!ownerSignature) return `${owner} hasn't signed it`;
  const ownerKey = await getPublicKeyFromAddress(owner);
  if (!(await verifySignature(ownerKey, ownerSignature, transaction.messageBytes))) {
    return `The signature of ${owner} doesn't verify`;
  }
  return null;
}

async function transferCheckedProblem(
  instruction: Instruction,
  owner: Address,
  usdc: Address,
): Promise<string | null> {
  if (
    instruction.programAddress !== TOKEN_PROGRAM_ADDRESS ||
    !instruction.data ||
    identifyTokenInstruction(instruction.data) !== TokenInstruction.TransferChecked ||
    instruction.accounts?.length !== 4
  ) {
    return "A Sweep ends with a USDC TransferChecked";
  }
  const { accounts } = parseTransferCheckedInstruction(instruction as never);
  if (accounts.mint.address !== usdc) return "A Sweep moves USDC only";
  if (accounts.authority.address !== owner) {
    return "The transfer must be authorized by the Receiving Address that signed it";
  }
  if (accounts.source.address !== (await usdcTokenAccount(owner, usdc))) {
    return "The transfer must come out of the Receiving Address's USDC token account";
  }
  return null;
}

async function tokenAccountCreationProblem(
  instruction: Instruction,
  feePayer: Address,
  usdc: Address,
  destination: Address,
): Promise<string | null> {
  if (
    instruction.programAddress !== ASSOCIATED_TOKEN_PROGRAM_ADDRESS ||
    !instruction.data ||
    identifyAssociatedTokenInstruction(instruction.data) !==
      AssociatedTokenInstruction.CreateAssociatedTokenIdempotent ||
    instruction.accounts?.length !== 6
  ) {
    return "Before the transfer, a Sweep may only create the destination's USDC token account";
  }
  const { accounts } = parseCreateAssociatedTokenIdempotentInstruction(instruction as never);
  if (
    accounts.payer.address !== feePayer ||
    accounts.mint.address !== usdc ||
    accounts.ata.address !== destination ||
    accounts.owner.address === feePayer ||
    accounts.ata.address !== (await usdcTokenAccount(accounts.owner.address, usdc)) ||
    accounts.systemProgram.address !== SYSTEM_PROGRAM_ADDRESS ||
    accounts.tokenProgram.address !== TOKEN_PROGRAM_ADDRESS
  ) {
    return "The token account a Sweep creates must be the destination's USDC token account, paid for by Herald";
  }
  return null;
}
