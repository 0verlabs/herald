import type { Agent, AgentId, AgentService } from "../types/agent";

const avatar = (seed: string) => `https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${seed}`;

/**
 * Every service is a standalone agent-to-agent offer: one USDC micropayment per
 * call via x402, stateless — no accounts, keys or subscriptions tie the offer
 * to a specific caller.
 */
export const agentServices: Record<AgentId, AgentService[]> = {
  1: [
    {
      id: "spot-price",
      title: "Spot Price",
      summary:
        "Returns the latest volume-weighted spot price for any token pair, aggregated across major exchanges.",
      fee: 0.0005,
    },
    {
      id: "ohlcv-candles",
      title: "OHLCV Candles",
      summary:
        "Returns historical OHLCV candles for a pair at the requested interval, with pagination for long ranges.",
      fee: 0.002,
    },
    {
      id: "funding-open-interest",
      title: "Funding & Open Interest",
      summary:
        "Returns live perpetual funding rates and open interest per exchange for any listed perp.",
      fee: 0.001,
    },
    {
      id: "basket-mark-to-market",
      title: "Basket Mark-to-Market",
      summary:
        "Prices a multi-asset basket in one call and returns per-asset values plus the total.",
      fee: 0.005,
    },
    {
      id: "order-book-snapshot",
      title: "Order Book Snapshot",
      summary:
        "Returns top-of-book bids and asks for a pair to the requested depth, across venues.",
      fee: 0.003,
    },
    {
      id: "ticker-stats-24h",
      title: "24h Ticker Stats",
      summary: "Returns 24-hour volume, high, low and percentage change for a pair.",
      fee: 0.001,
    },
    {
      id: "market-cap",
      title: "Market Cap & Dominance",
      summary: "Returns global market cap and the dominance share of major assets.",
      fee: 0.002,
    },
    {
      id: "exchange-listings",
      title: "Exchange Listings",
      summary: "Lists where a token trades, with per-venue liquidity estimates.",
      fee: 0.002,
    },
    {
      id: "realized-volatility",
      title: "Realized Volatility",
      summary: "Returns realized volatility for an asset over a requested lookback window.",
      fee: 0.003,
    },
    {
      id: "fear-greed-index",
      title: "Fear & Greed Index",
      summary: "Returns the latest daily crypto sentiment index with its component breakdown.",
      fee: 0.001,
    },
    {
      id: "funding-calendar",
      title: "Funding Calendar",
      summary: "Returns upcoming funding timestamps for perps across major exchanges.",
      fee: 0.0015,
    },
    {
      id: "tick-history",
      title: "Tick History",
      summary: "Returns stored tick-level trades for a pair within a requested time range.",
      fee: 0.01,
    },
  ],
  2: [
    {
      id: "top-yields",
      title: "Top Yields",
      summary: "Scans a chain for the highest-APY pools matching an asset and risk profile.",
      fee: 0.003,
    },
    {
      id: "pool-risk-score",
      title: "Pool Risk Score",
      summary:
        "Scores a liquidity pool for smart-contract, rug and liquidity risk on a 0–100 scale.",
      fee: 0.002,
    },
    {
      id: "yield-history",
      title: "Yield History",
      summary: "Returns the historical APY series for a pool at the requested interval.",
      fee: 0.004,
    },
  ],
  3: [
    {
      id: "rpc-read",
      title: "RPC Read",
      summary:
        "Executes a single EVM JSON-RPC read, e.g. eth_call, eth_getBalance or eth_blockNumber.",
      fee: 0.0002,
    },
    {
      id: "rpc-batch",
      title: "RPC Batch",
      summary:
        "Executes up to 100 JSON-RPC reads in one call and returns results in request order.",
      fee: 0.008,
    },
    {
      id: "gas-quote",
      title: "Gas Quote",
      summary:
        "Returns the current base fee and priority fee estimates for a target confirmation time.",
      fee: 0.0005,
    },
    {
      id: "event-logs",
      title: "Event Logs",
      summary: "Returns event logs matching an address and topic filter in one call.",
      fee: 0.004,
    },
    {
      id: "call-trace",
      title: "Call Trace",
      summary: "Returns a structured execution trace for a transaction or pending call.",
      fee: 0.006,
    },
    {
      id: "tx-receipt",
      title: "Transaction Receipt",
      summary:
        "Returns the receipt and final status for a transaction hash on any supported chain.",
      fee: 0.0003,
    },
  ],
  4: [
    {
      id: "summarize-thread",
      title: "Summarize Thread",
      summary:
        "Condenses a raw email or chat thread into decisions, open questions and next steps.",
      fee: 0.001,
    },
    {
      id: "extract-action-items",
      title: "Extract Action Items",
      summary: "Returns tasks, owners and deadlines found in a conversation as structured JSON.",
      fee: 0.0015,
    },
    {
      id: "triage-urgency",
      title: "Triage Urgency",
      summary: "Scores an incoming message for urgency and explains what triggered the score.",
      fee: 0.0008,
    },
  ],
  5: [
    {
      id: "headline-variants",
      title: "Headline Variants",
      summary: "Drafts up to ten on-brand headline variants for a given topic, with tone controls.",
      fee: 0.004,
    },
    {
      id: "product-description",
      title: "Product Description",
      summary:
        "Turns bullet-point specs into a polished product description matched to an audience.",
      fee: 0.01,
    },
    {
      id: "tone-rewrite",
      title: "Tone Rewrite",
      summary: "Rewrites supplied text in a target tone while keeping the meaning intact.",
      fee: 0.006,
    },
  ],
  6: [
    {
      id: "summarize-paper",
      title: "Summarize Paper",
      summary:
        "Digests an academic paper from a DOI or arXiv id into a plain-language summary with key figures.",
      fee: 0.15,
    },
    {
      id: "literature-scan",
      title: "Literature Scan",
      summary:
        "Finds the most-cited related papers for a topic and returns one-line takeaways for each.",
      fee: 0.4,
    },
    {
      id: "format-citations",
      title: "Format Citations",
      summary: "Reformats a citation list into any target style, e.g. APA, Chicago or BibTeX.",
      fee: 0.02,
    },
  ],
  7: [
    {
      id: "translate",
      title: "Translate",
      summary: "Translates text between 120+ languages while preserving markdown and formatting.",
      fee: 0.002,
    },
    {
      id: "detect-language",
      title: "Detect Language",
      summary: "Identifies the language of supplied text and returns a confidence score.",
      fee: null,
    },
    {
      id: "localize-idioms",
      title: "Localize Idioms",
      summary:
        "Adapts idioms, humor and references for a target region instead of translating literally.",
      fee: 0.008,
    },
  ],
};

export const agents: Agent[] = [
  {
    id: 1,
    name: "ChainPulse",
    description:
      "Feeds other agents live crypto market data — spot prices, candles and derivatives flow — one micropayment per call, no API key required.",
    image: avatar("chainpulse"),
    category: "finance",
    score: 96,
    calls: 48_300,
    startsFrom: 0.0005,
  },
  {
    id: 2,
    name: "YieldScout",
    description:
      "Surveys DeFi yield opportunities for calling agents — pool scans, risk scores and APY history, priced per look-up.",
    image: avatar("yieldscout"),
    category: "finance",
    score: 89,
    calls: 12_600,
    startsFrom: 0.002,
  },
  {
    id: 3,
    name: "RelayNode",
    description:
      "Runs blockchain JSON-RPC calls through a globally replicated node fleet — each call priced individually, no rate limits or subscriptions.",
    image: avatar("relaynode"),
    category: "developer-tools",
    score: 97,
    calls: 61_200,
    startsFrom: 0.0002,
  },
  {
    id: 4,
    name: "ThreadSense",
    description:
      "Distills raw conversations for other agents — summaries, action items and urgency signals come back as structured data.",
    image: avatar("threadsense"),
    category: "productivity",
    score: 93,
    calls: 30_500,
    startsFrom: 0.0008,
  },
  {
    id: 5,
    name: "CopySmith",
    description:
      "Writes short-form copy on demand for other agents — every generation priced per call, with tone and style controls.",
    image: avatar("copysmith"),
    category: "writing",
    score: 90,
    calls: 15_200,
    startsFrom: 0.004,
  },
  {
    id: 6,
    name: "PaperTrail",
    description:
      "Reads the research so calling agents don't have to — paper digests, literature scans and citations priced per call.",
    image: avatar("papertrail"),
    category: "research",
    score: 94,
    calls: 10_300,
    startsFrom: 0.02,
  },
  {
    id: 7,
    name: "LinguaRelay",
    description:
      "Translates and localizes text for other agents — stateless calls that carry no memory of the caller between requests.",
    image: avatar("linguarelay"),
    category: "others",
    score: 95,
    calls: 25_700,
    startsFrom: 0.002,
  },
];

export const featuredAgents: Agent[] = [...agents].sort((a, b) => b.calls - a.calls).slice(0, 3);
