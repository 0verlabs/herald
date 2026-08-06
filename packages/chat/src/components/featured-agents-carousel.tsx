import { Link } from "@tanstack/react-router";
import Autoplay from "embla-carousel-autoplay";

import { Avatar, AvatarImage } from "@ivanius.ai/ui/components/avatar";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@ivanius.ai/ui/components/carousel";
import { Separator } from "@ivanius.ai/ui/components/separator";
import { Skeleton } from "@ivanius.ai/ui/components/skeleton";

import { useFeaturedAgents } from "../hooks/use-featured-agents";
import { formatCompactNumber } from "../lib/format";

/** Full-width hero carousel of featured agents, shown atop the /agents page. */
export function FeaturedAgentsCarousel() {
  const { data: agents, isPending } = useFeaturedAgents();

  if (isPending) return <Skeleton className="min-h-72" />;

  if (!agents || agents?.length === 0) return null;

  const hasMultipleSlides = agents.length > 1;

  return (
    <Carousel
      opts={{ loop: hasMultipleSlides }}
      plugins={[
        Autoplay({
          delay: 4000,
          stopOnInteraction: false,
          stopOnLastSnap: false,
          stopOnFocusIn: true,
          stopOnMouseEnter: true,
        }),
      ]}
      className="w-full"
    >
      <CarouselContent>
        {agents.map((agent) => (
          <CarouselItem key={agent.id} className="bg-accent/5 basis-full">
            <Link to="/agents/$agentId" params={{ agentId: agent.id }}>
              <div className="flex min-h-72 mx-auto max-w-6xl px-6 items-center justify-between gap-4">
                <div className="flex flex-col gap-3">
                  <div className="max-w-xl">
                    <h2 className="text-2xl font-serif font-medium leading-loose">{agent.name}</h2>
                    <p className="text-sm text-muted-foreground/80 leading-tight line-clamp-4">
                      {agent.description}
                    </p>
                  </div>
                  <div className="inline-flex w-fit items-center gap-3 text-xs font-medium font-mono">
                    <span>Score: {agent.score}/100</span>
                    <Separator orientation="vertical" className="bg-foreground/50" />
                    <span>{formatCompactNumber(agent.calls)} calls</span>
                  </div>
                </div>
                <Avatar className="rounded-2xl after:rounded-2xl size-32 md:size-48">
                  <AvatarImage src={agent.image} alt={agent.name} className="rounded-2xl" />
                </Avatar>
              </div>
            </Link>
          </CarouselItem>
        ))}
      </CarouselContent>
      {hasMultipleSlides && (
        <div className="hidden md:block">
          <CarouselPrevious className="left-24 border-white/20 bg-white/10 text-white hover:bg-white/20" />
          <CarouselNext className="right-24 border-white/20 bg-white/10 text-white hover:bg-white/20" />
        </div>
      )}
    </Carousel>
  );
}
