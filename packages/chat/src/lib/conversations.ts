import type { TanStackChat } from "@shadcn/helpers/tanstack-ai";
import { createChat } from "@shadcn/helpers/tanstack-ai";
import { addSeconds, subMinutes } from "date-fns";

import { chats } from "./mock-data";

/**
 * Scripted mock conversations, replayed through TanStack AI's `useChat` via
 * the @shadcn/helpers local connection adapter — no backend involved.
 *
 * Convention: the first `reasoning` entry is the one-line summary shown as the
 * collapsed reasoning trigger; the rest are the thinking steps inside it.
 */
interface ScriptedTurn {
  user: string;
  reasoning: [summary: string, ...steps: string[]];
  response: string;
}

const swapTurns: ScriptedTurn[] = [
  {
    user: "I want to swap 500 USDC for ETH on Base. What's the best route right now, and what should I watch out for?",
    reasoning: [
      "Compared aggregator routes and fees for a 500 USDC swap on Base",
      "The user wants to swap 500 USDC for ETH on Base. I should compare the main aggregator routes, estimate slippage and gas, and flag anything that affects the final quote.",
      "The Uniswap v3 pool has the deepest liquidity right now, so the best route collapses to a single hop with minimal price impact.",
    ],
    response: `## Swapping 500 USDC → ETH on Base

Here's the best route I found, along with what to double-check before you sign.

### Route Summary

- **Aggregator:** 1inch (routes through Uniswap v3)
- **Expected output:** ~0.1284 ETH
- **Price impact:** 0.04%
- **Network fee:** ~$0.02 on Base

### Steps

1. **Approve** USDC spending for the router — one-time, costs about a cent.
2. **Review** the quote: output amount, minimum received, and price impact.
3. **Sign** the swap transaction in your wallet.
4. **Verify** the ETH arrives with the transaction link I'll post here.

> Tip: Keep slippage at 0.5% or lower for stable → ETH swaps. Anything higher invites sandwich bots.

### Quote Comparison

| Venue | Output (ETH) | Price Impact | Fee |
| --- | --- | --- | --- |
| 1inch | 0.12840 | 0.04% | $0.02 |
| Uniswap v3 | 0.12836 | 0.05% | $0.02 |
| Aerodrome | 0.12790 | 0.09% | $0.03 |

Here's the call I'll submit, so you can verify it before signing:

\`\`\`text
swapExactTokensForTokens(500 USDC, minOut: 0.1278 ETH, deadline: +20 min)
\`\`\`

The minimum received (\`0.1278 ETH\`) already includes your slippage tolerance — the transaction reverts rather than filling below it.

---

*Ready when you are — say the word and I'll prepare the transaction.* 🚀`,
  },
  {
    user: "Looks good — go ahead with the 1inch route.",
    reasoning: [
      "Prepared the 1inch swap transaction for a wallet signature",
      "The user confirmed the 1inch route. I should prepare the transaction, restate the key numbers, and hand off for a wallet signature.",
    ],
    response: `Transaction prepared. Here's the final summary:

| Field | Value |
| --- | --- |
| Sell | 500 USDC |
| Buy (est.) | 0.1284 ETH |
| Minimum received | 0.1278 ETH |
| Route | 1inch → Uniswap v3 |

1. A signature request is now waiting in your wallet.
2. Once signed, I'll track the transaction and confirm when it lands — usually **under 5 seconds** on Base.

> Nothing moves until you sign. Rejecting the request cancels the swap with no fee.`,
  },
];

const paymentChannelTurns: ScriptedTurn[] = [
  {
    user: "Set up an agent-to-agent payment channel so my research agent can pay vendor agents directly. Budget is 50 USDC per week.",
    reasoning: [
      "Designed a capped A2A payment channel with a weekly budget",
      "The user wants their research agent to pay vendors autonomously, capped at 50 USDC per week. I should propose a channel config with a hard spending limit and a revocation path.",
      "An x402-style channel with a weekly allowance covers this without giving the agent unbounded access to the wallet.",
    ],
    response: `## A2A Payment Channel Setup

Your research agent gets its own spending lane — funds stay in your wallet until a payment is actually made.

### Channel Configuration

\`\`\`json
{
  "payer": "research-agent.ivanius.eth",
  "allowance": "50 USDC",
  "period": "weekly",
  "settlement": "x402",
  "revocable": true
}
\`\`\`

### How it works

1. **Open** the channel with a signed allowance — no funds are locked upfront.
2. Vendor agents **invoice** through the registry; payments settle over x402.
3. The allowance **resets** every Monday at 00:00 UTC.
4. **Revoke** at any time with a single transaction.

### Safety rails

| Rail | Setting |
| --- | --- |
| Weekly cap | \`50 USDC\` |
| Per-payment cap | \`10 USDC\` |
| Unknown vendors | Require approval |

> If the agent hits the cap, further payments queue for your approval instead of failing silently.

Want me to open the channel now?`,
  },
];

const delegateTurns: ScriptedTurn[] = [
  {
    user: "Delegate the L2 fee market research to a sub-agent. I want a summary by tomorrow morning.",
    reasoning: [
      "Scoped the research task and picked a sub-agent for delegation",
      "The user wants L2 fee market research delegated with a morning deadline. I should scope the task, pick a capable sub-agent from the registry, and set the deliverable format.",
    ],
    response: `## Research Delegated

I've handed the task to \`scout-7\`, a research agent with strong coverage of L2 economics.

### Task brief

- Compare **fee markets** across Base, Arbitrum, and OP Mainnet
- Focus on the last 90 days of blob pricing after the Fusaka upgrade
- Deliverable: a one-page summary with charts, due **tomorrow 8:00 AM**

### What happens next

1. \`scout-7\` accepted the task and quoted **4.50 USDC**, paid from your agent allowance.
2. Progress updates land in this thread as they come in.
3. You'll get the final summary here for review before it's archived.

> You can cancel the delegation at any point before delivery for a partial refund.

*I'll ping you the moment the summary arrives.* 📬`,
  },
];

const scriptedTurns: Record<string, ScriptedTurn[]> = {
  "chat-01": swapTurns,
  "chat-02": paymentChannelTurns,
  "chat-03": delegateTurns,
};

/** Lowercase the leading verb so a sidebar title reads as part of a sentence. */
function asSentence(title: string) {
  return title.charAt(0).toLowerCase() + title.slice(1);
}

function genericTurns(title: string): ScriptedTurn[] {
  return [
    {
      user: `I want to ${asSentence(title)}. Walk me through it.`,
      reasoning: [
        `Outlined a safe plan to ${asSentence(title)}`,
        `The user wants to ${asSentence(title)}. I should lay out the steps, surface the risks worth double-checking, and keep everything simulated until they explicitly confirm.`,
      ],
      response: `## ${title}

Here's a safe path from start to finish.

### Before you start

- Double-check the **destination address** — on-chain transfers are irreversible.
- Keep a small gas buffer on the source chain.
- Prefer audited, battle-tested contracts over fresh deployments.

### Steps

1. **Review** the current quote and fees.
2. **Simulate** the transaction to confirm the outcome.
3. **Sign** once the numbers match what you expect.
4. **Track** the confirmation until finality.

> Everything is simulated before signing, so you can bail out at any step.

| Check | Status |
| --- | --- |
| Contract audit | Passed |
| Simulation | Matches quote |
| Spending cap | \`50 USDC / week\` |

*Say \`go\` and I'll queue the first step.*`,
    },
  ];
}

function buildScript(turns: ScriptedTurn[], endedAt: Date): TanStackChat {
  const chat = createChat();
  turns.forEach((turn, index) => {
    const askedAt = subMinutes(endedAt, (turns.length - index) * 5);
    chat
      .user(turn.user, { metadata: { createdAt: askedAt } })
      .sleep(600)
      .assistant(
        ({ writer }) => {
          // One reasoning part; blank lines delimit the steps for the UI.
          writer.reasoning(turn.reasoning.join("\n\n"));
          writer.sleep(400);
          writer.text(turn.response);
        },
        { metadata: { createdAt: addSeconds(askedAt, 45) } }
      );
  });
  return chat;
}

const scripts = new Map<string, TanStackChat>();

/**
 * The scripted conversation for a chat id. Chats created at runtime (or
 * unknown ids) get an empty script; the transport fallback answers those.
 */
export function getChatScript(chatId: string): TanStackChat {
  let script = scripts.get(chatId);
  if (!script) {
    const summary = chats.find((chat) => chat.id === chatId);
    const turns = summary ? (scriptedTurns[chatId] ?? genericTurns(summary.title)) : [];
    script = buildScript(turns, summary?.updatedAt ?? new Date());
    scripts.set(chatId, script);
  }
  return script;
}

const FALLBACK_RESPONSE = `Got it — here's how I'd approach that:

- **Clarify the goal** so the transaction does exactly what you expect.
- **Simulate first** — I never sign anything without a dry run.
- **Confirm the numbers**, then execute and track it to finality.

> This is a mock conversation, so nothing is actually sent on-chain.

Give me a \`go\` and I'll take the first step.`;

/** One streaming connection per mounted chat screen, sharing a generic fallback. */
export function createChatConnection(script: TanStackChat) {
  return script.transport({
    delayMs: 20,
    fallback: ({ writer }) => {
      writer.reasoning(
        [
          "Drafted a quick plan before replying",
          "There's no scripted reply for this message, so I should answer with a short, generally useful plan.",
        ].join("\n\n")
      );
      writer.sleep(400);
      writer.text(FALLBACK_RESPONSE);
    },
  });
}
