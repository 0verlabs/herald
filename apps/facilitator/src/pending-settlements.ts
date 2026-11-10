import { PENDING_SETTLEMENT_TTL_MS } from "@x402/core/facilitator";

/**
 * A chain queue's store of the stock mechanisms' pending settlements: a
 * settlement whose confirmation didn't arrive in time is retried once by the
 * Provider's resource server, often on another isolate, and the retry must
 * find the transaction here instead of submitting again. Kept in the chain
 * queue's SQLite storage, in a `pending_settlements` table it creates.
 */
export class PendingSettlements {
  readonly #sql: SqlStorage;

  constructor(sql: SqlStorage) {
    this.#sql = sql;
    sql.exec(
      `CREATE TABLE IF NOT EXISTS pending_settlements (
        settlement_key TEXT PRIMARY KEY,
        tx_hash TEXT NOT NULL,
        stored_at INTEGER NOT NULL
      )`,
    );
  }

  get(settlementKey: string): string | undefined {
    this.#sql.exec(
      "DELETE FROM pending_settlements WHERE stored_at < ?",
      Date.now() - PENDING_SETTLEMENT_TTL_MS,
    );
    const [row] = this.#sql
      .exec<{ tx_hash: string }>(
        "SELECT tx_hash FROM pending_settlements WHERE settlement_key = ?",
        settlementKey,
      )
      .toArray();
    return row?.tx_hash;
  }

  set(settlementKey: string, txHash: string): void {
    this.#sql.exec(
      "INSERT OR REPLACE INTO pending_settlements (settlement_key, tx_hash, stored_at) VALUES (?, ?, ?)",
      settlementKey,
      txHash,
      Date.now(),
    );
  }

  delete(settlementKey: string): void {
    this.#sql.exec("DELETE FROM pending_settlements WHERE settlement_key = ?", settlementKey);
  }
}
