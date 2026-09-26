export type ErrorCode =
  | "FLAG_CONFLICT"
  | "NOT_LOGGED_IN"
  | "DEVICE_AUTH_DISABLED"
  | "DEVICE_AUTH_FAILED"
  | "AUTH_PENDING"
  | "DEVICE_CODE_EXPIRED"
  | "AUTH_DENIED"
  | "TOKEN_REQUEST_FAILED"
  | "SESSION_EXPIRED"
  | "WALLET_AUTH_FAILED"
  | "WALLET_NOT_FOUND"
  | "WALLET_NOT_ACCESSIBLE"
  | "WALLET_RPC_FAILED";

export class CliError extends Error {
  readonly code: ErrorCode;
  readonly recovery?: string;

  constructor(code: ErrorCode, message: string, recovery?: string) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.recovery = recovery;
  }
}
