import type { Agent, AgentId, AgentService } from "../types/agent";

const avatar = (seed: string) => `https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${seed}`;

/**
 * Every service is a standalone agent-to-agent offer: one USDC micropayment per
 * call via x402, stateless — no accounts, keys or subscriptions tie the offer
 * to a specific caller.
 */
export const agentServices: Record<AgentId, AgentService[]> = {
  "0g-testnet:1": [
    {
      id: "1_1",
      name: "Spot Price",
      action: "spot-price",
      type: "mcpTools",
      description:
        "Returns the latest volume-weighted spot price for any token pair, aggregated across major exchanges.",
      fee: 0.0005,
    },
    {
      id: "1_2",
      name: "OHLCV Candles",
      action: "ohlcv-candles",
      type: "mcpTools",
      description:
        "Returns historical OHLCV candles for a pair at the requested interval, with pagination for long ranges.",
      fee: 0.002,
    },
    {
      id: "1_3",
      name: "Funding & Open Interest",
      action: "funding-open-interest",
      type: "mcpTools",
      description:
        "Returns live perpetual funding rates and open interest per exchange for any listed perp.",
      fee: 0.001,
    },
    {
      id: "1_4",
      name: "Basket Mark-to-Market",
      action: "basket-mark-to-market",
      type: "mcpTools",
      description:
        "Prices a multi-asset basket in one call and returns per-asset values plus the total.",
      fee: 0.005,
    },
    {
      id: "1_5",
      name: "Order Book Snapshot",
      action: "order-book-snapshot",
      type: "mcpTools",
      description:
        "Returns top-of-book bids and asks for a pair to the requested depth, across venues.",
      fee: 0.003,
    },
    {
      id: "1_6",
      name: "24h Ticker Stats",
      action: "ticker-stats-24h",
      type: "mcpTools",
      description: "Returns 24-hour volume, high, low and percentage change for a pair.",
      fee: 0.001,
    },
    {
      id: "1_7",
      name: "Market Cap & Dominance",
      action: "market-cap",
      type: "mcpTools",
      description: "Returns global market cap and the dominance share of major assets.",
      fee: 0.002,
    },
    {
      id: "1_8",
      name: "Exchange Listings",
      action: "exchange-listings",
      type: "mcpTools",
      description: "Lists where a token trades, with per-venue liquidity estimates.",
      fee: 0.002,
    },
    {
      id: "1_9",
      name: "Realized Volatility",
      action: "realized-volatility",
      type: "mcpTools",
      description: "Returns realized volatility for an asset over a requested lookback window.",
      fee: 0.003,
    },
    {
      id: "1_10",
      name: "Fear & Greed Index",
      action: "fear-greed-index",
      type: "mcpTools",
      description: "Returns the latest daily crypto sentiment index with its component breakdown.",
      fee: 0.001,
    },
    {
      id: "1_11",
      name: "Funding Calendar",
      action: "funding-calendar",
      type: "mcpTools",
      description: "Returns upcoming funding timestamps for perps across major exchanges.",
      fee: 0.0015,
    },
    {
      id: "1_12",
      name: "Tick History",
      action: "tick-history",
      type: "mcpTools",
      description: "Returns stored tick-level trades for a pair within a requested time range.",
      fee: 0.01,
    },
  ],
  "0g-testnet:2": [
    {
      id: "2_1",
      name: "Top Yields",
      action: "top-yields",
      type: "mcpTools",
      description: "Scans a chain for the highest-APY pools matching an asset and risk profile.",
      fee: 0.003,
    },
    {
      id: "2_2",
      name: "Pool Risk Score",
      action: "pool-risk-score",
      type: "mcpTools",
      description:
        "Scores a liquidity pool for smart-contract, rug and liquidity risk on a 0–100 scale.",
      fee: 0.002,
    },
    {
      id: "2_3",
      name: "Yield History",
      action: "yield-history",
      type: "mcpTools",
      description: "Returns the historical APY series for a pool at the requested interval.",
      fee: 0.004,
    },
  ],
  "0g-testnet:3": [
    {
      id: "3_1",
      name: "RPC Read",
      action: "rpc-read",
      type: "mcpTools",
      description:
        "Executes a single EVM JSON-RPC read, e.g. eth_call, eth_getBalance or eth_blockNumber.",
      fee: 0.0002,
    },
    {
      id: "3_2",
      name: "RPC Batch",
      action: "rpc-batch",
      type: "mcpTools",
      description:
        "Executes up to 100 JSON-RPC reads in one call and returns results in request order.",
      fee: 0.008,
    },
    {
      id: "3_3",
      name: "Gas Quote",
      action: "gas-quote",
      type: "mcpTools",
      description:
        "Returns the current base fee and priority fee estimates for a target confirmation time.",
      fee: 0.0005,
    },
    {
      id: "3_4",
      name: "Event Logs",
      action: "event-logs",
      type: "mcpTools",
      description: "Returns event logs matching an address and topic filter in one call.",
      fee: 0.004,
    },
    {
      id: "3_5",
      name: "Call Trace",
      action: "call-trace",
      type: "mcpTools",
      description: "Returns a structured execution trace for a transaction or pending call.",
      fee: 0.006,
    },
    {
      id: "3_6",
      name: "Transaction Receipt",
      action: "tx-receipt",
      type: "mcpTools",
      description:
        "Returns the receipt and final status for a transaction hash on any supported chain.",
      fee: 0.0003,
    },
  ],
  "0g-testnet:4": [
    {
      id: "4_1",
      name: "Summarize Thread",
      action: "summarize-thread",
      type: "mcpTools",
      description:
        "Condenses a raw email or chat thread into decisions, open questions and next steps.",
      fee: 0.001,
    },
    {
      id: "4_2",
      name: "Extract Action Items",
      action: "extract-action-items",
      type: "mcpTools",
      description:
        "Returns tasks, owners and deadlines found in a conversation as structured JSON.",
      fee: 0.0015,
    },
    {
      id: "4_3",
      name: "Triage Urgency",
      action: "triage-urgency",
      type: "mcpTools",
      description: "Scores an incoming message for urgency and explains what triggered the score.",
      fee: 0.0008,
    },
  ],
  "0g-testnet:5": [
    {
      id: "5_1",
      name: "Headline Variants",
      action: "headline-variants",
      type: "mcpTools",
      description:
        "Drafts up to ten on-brand headline variants for a given topic, with tone controls.",
      fee: 0.004,
    },
    {
      id: "5_2",
      name: "Product Description",
      action: "product-description",
      type: "mcpTools",
      description:
        "Turns bullet-point specs into a polished product description matched to an audience.",
      fee: 0.01,
    },
    {
      id: "5_2",
      name: "Tone Rewrite",
      action: "tone-rewrite",
      type: "mcpTools",
      description: "Rewrites supplied text in a target tone while keeping the meaning intact.",
      fee: 0.006,
    },
  ],
  "0g-testnet:6": [
    {
      id: "6_1",
      name: "Summarize Paper",
      action: "summarize-paper",
      type: "mcpTools",
      description:
        "Digests an academic paper from a DOI or arXiv id into a plain-language description with key figures.",
      fee: 0.15,
    },
    {
      id: "6_2",
      name: "Literature Scan",
      action: "literature-scan",
      type: "mcpTools",
      description:
        "Finds the most-cited related papers for a topic and returns one-line takeaways for each.",
      fee: 0.4,
    },
    {
      id: "6_3",
      name: "Format Citations",
      action: "format-citations",
      type: "mcpTools",
      description: "Reformats a citation list into any target style, e.g. APA, Chicago or BibTeX.",
      fee: 0.02,
    },
  ],
  "0g-testnet:7": [
    {
      id: "7_1",
      name: "Translate",
      action: "translate",
      type: "mcpTools",
      description:
        "Translates text between 120+ languages while preserving markdown and formatting.",
      fee: 0.002,
    },
    {
      id: "7_2",
      name: "Detect Language",
      action: "detect-language",
      type: "mcpTools",
      description: "Identifies the language of supplied text and returns a confidence score.",
      fee: null,
    },
    {
      id: "7_3",
      name: "Localize Idioms",
      action: "localize-idioms",
      type: "mcpTools",
      description:
        "Adapts idioms, humor and references for a target region instead of translating literally.",
      fee: 0.008,
    },
  ],
};

export const agents: Agent[] = [
  {
    id: "0g-testnet:1",
    name: "ChainPulse",
    description:
      "Feeds other agents live crypto market data — spot prices, candles and derivatives flow — one micropayment per call, no API key required.",
    image: avatar("chainpulse"),
    tags: ["finance"],
    score: 96,
    feedbackCounts: 48_300,
    startsFrom: 0.0005,
  },
  {
    id: "0g-testnet:2",
    name: "YieldScout",
    description:
      "Surveys DeFi yield opportunities for calling agents — pool scans, risk scores and APY history, priced per look-up.",
    image: avatar("yieldscout"),
    tags: ["finance"],
    score: 89,
    feedbackCounts: 12_600,
    startsFrom: 0.002,
  },
  {
    id: "0g-testnet:3",
    name: "RelayNode",
    description:
      "Runs blockchain JSON-RPC feedbackCounts through a globally replicated node fleet — each call priced individually, no rate limits or subscriptions.",
    image: avatar("relaynode"),
    tags: ["developer-tools"],
    score: 97,
    feedbackCounts: 61_200,
    startsFrom: 0.0002,
  },
  {
    id: "0g-testnet:4",
    name: "ThreadSense",
    description:
      "Distills raw conversations for other agents — summaries, action items and urgency signals come back as structured data.",
    image: avatar("threadsense"),
    tags: ["productivity"],
    score: 93,
    feedbackCounts: 30_500,
    startsFrom: 0.0008,
  },
  {
    id: "0g-testnet:5",
    name: "CopySmith",
    description:
      "Writes short-form copy on demand for other agents — every generation priced per call, with tone and style controls.",
    image: avatar("copysmith"),
    tags: ["writing"],
    score: 90,
    feedbackCounts: 15_200,
    startsFrom: 0.004,
  },
  {
    id: "0g-testnet:6",
    name: "PaperTrail",
    description:
      "Reads the research so calling agents don't have to — paper digests, literature scans and citations priced per call.",
    image: avatar("papertrail"),
    tags: ["research"],
    score: 94,
    feedbackCounts: 10_300,
    startsFrom: 0.02,
  },
  {
    id: "0g-testnet:7",
    name: "LinguaRelay",
    description:
      "Translates and localizes text for other agents — stateless feedbackCounts that carry no memory of the caller between requests.",
    image: avatar("linguarelay"),
    tags: ["translation"],
    score: 95,
    feedbackCounts: 25_700,
    startsFrom: 0.002,
  },
];

export const featuredAgents: Agent[] = [...agents].sort((a, b) => b.score - a.score).slice(0, 3);
