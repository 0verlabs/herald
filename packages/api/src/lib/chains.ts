import { zeroGMainnet, zeroGTestnet } from "viem/chains";

import type { ChainSlug, EvmChainConfig } from "../types/chain";

// `caip2` and `tokens.native` are both derived from the viem chain so neither can drift from it
// — 0G has two testnet chain ids in circulation (16602 live, 16601 deprecated), and a
// hand-written pairing is the likeliest way this registry would go wrong.
//
// `tokens.usdc` is absent where the token has no deployment. 0G Galileo has none yet — a mock
// lands later — and until then asking for USDC must fail loudly rather than resolve to a
// plausible-looking wrong address. Mainnet's deployment is bridged USDC: the name and symbol
// here are the values the contract itself reports, not the ones we wish it reported.
export const chains = {
  "0g": {
    caip2: `eip155:${zeroGMainnet.id}`,
    network: "evm",
    chain: zeroGMainnet,
    tokens: {
      native: zeroGMainnet.nativeCurrency,
      usdc: {
        address: "0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E",
        name: "Bridged USDC",
        symbol: "USDC.e",
        decimals: 6,
      },
    },
    txUrl: (txHash) => `${zeroGMainnet.blockExplorers.default.url}/tx/${txHash}`,
  },
  "0g-testnet": {
    caip2: `eip155:${zeroGTestnet.id}`,
    network: "evm",
    chain: zeroGTestnet,
    tokens: {
      native: zeroGTestnet.nativeCurrency,
      usdc: undefined,
    },
    txUrl: (txHash) => `${zeroGTestnet.blockExplorers.default.url}/tx/${txHash}`,
  },
} satisfies Record<ChainSlug, EvmChainConfig>;

export function requireUsdc(slug: ChainSlug) {
  const usdc = chains[slug].tokens.usdc;
  if (!usdc) throw new Error(`USDC is not deployed on ${chains[slug].chain.name}`);
  return usdc;
}
