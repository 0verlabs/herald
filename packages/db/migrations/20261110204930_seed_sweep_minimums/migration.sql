-- Sweep minimums, in USDC base units (6 decimals), seeded from
-- docs/research/stack-and-minimums.md (Part B, read 2026-11-09 20:45 UTC).
-- Mainnet rows are 1Click's minimum deposit for each chain's USDC, so a
-- Sweep that later goes through 1Click isn't refused. 1Click has no testnet,
-- so each testnet network mirrors its mainnet counterpart.
INSERT INTO `sweep_minimums` (`network`, `asset`, `minimum`, `note`, `updated_at`) VALUES
  ('eip155:8453', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', '150000', '1Click minimum deposit for Base USDC: 0.15 USDC (stack-and-minimums.md, 2026-11-09).', 1794257112000),
  ('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', '1000', '1Click minimum deposit for Solana USDC: 0.001 USDC (stack-and-minimums.md, 2026-11-09).', 1794257112000),
  ('eip155:42161', '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', '1000', '1Click minimum deposit for Arbitrum USDC: 0.001 USDC (stack-and-minimums.md, 2026-11-09).', 1794257112000),
  ('eip155:137', '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', '1000', '1Click minimum deposit for Polygon USDC: 0.001 USDC (stack-and-minimums.md, 2026-11-09).', 1794257112000),
  ('eip155:43114', '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', '1000', '1Click minimum deposit for Avalanche USDC: 0.001 USDC (stack-and-minimums.md, 2026-11-09).', 1794257112000),
  ('eip155:84532', '0x036CbD53842c5426634e7929541eC2318f3dCF7e', '150000', 'Testnet: mirrors Base mainnet (0.15 USDC). 1Click has no testnet.', 1794257112000),
  ('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', '1000', 'Testnet: mirrors Solana mainnet (0.001 USDC). 1Click has no testnet.', 1794257112000),
  ('eip155:421614', '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', '1000', 'Testnet: mirrors Arbitrum mainnet (0.001 USDC). 1Click has no testnet.', 1794257112000);
