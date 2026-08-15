import type { NativeTokenConfig, TokenConfig } from "../types/token";

export const isTokenConfig = (config: NativeTokenConfig | TokenConfig): config is TokenConfig =>
  !!(config as TokenConfig).address;
