import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@0verlabs/herald-ui/components/avatar";
import { Separator } from "@0verlabs/herald-ui/components/separator";

import type { Agent } from "../types/agent";
import { agentInitials, agentScoreClassName } from "../lib/agent";
import { formatCompactNumber } from "../lib/format";

/** Identity header for the agent detail page: back link, avatar, name, stats. */
export function AgentHero({ agent }: { agent: Agent }) {
  return (
    <section className="flex flex-col gap-5">
      <Link
        to="/agents"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft />
        Explore
      </Link>
      <div className="flex items-start gap-4">
        <Avatar className="size-36 rounded-xl after:rounded-xl">
          <AvatarImage src={agent.image} alt={agent.name} className="rounded-xl" />
          <AvatarFallback className="rounded-xl text-lg">
            {agentInitials(agent.name)}
          </AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-1 self-stretch flex-col gap-1.5 pb-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-serif text-2xl font-medium md:text-3xl">{agent.name}</h1>
          </div>
          <p className="text-muted-foreground line-clamp-3 max-w-2xl">{agent.description}</p>
          <div className="mt-auto flex flex-wrap items-center gap-2 pt-2 font-mono text-xs text-muted-foreground">
            {agent.score === 0 ? (
              <span>No ratings</span>
            ) : (
              <span className="font-medium">
                <span>Score: </span>
                <span className={agentScoreClassName(agent.score)}>{agent.score}</span>
              </span>
            )}
            {agent.feedbackCounts > 0 && (
              <>
                <Separator orientation="vertical" className="h-3 bg-foreground/40" />
                <span>{formatCompactNumber(agent.feedbackCounts)} feedbacks</span>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
