import { Button } from "@hrld/ui/components/button";
import { Card, CardDescription, CardFooter, CardTitle } from "@hrld/ui/components/card";
import { Skeleton } from "@hrld/ui/components/skeleton";

import type { AgentFee, AgentService } from "../types/agent";
import UsdcLogo from "../assets/logos/usdc.svg?react";
import { formatPrice } from "../lib/format";

function ServiceFee({ fee }: { fee: AgentFee }) {
  if (fee === null) {
    return (
      <span className="items-center font-mono text-muted-foreground inline-flex gap-1.5">Free</span>
    );
  }
  return (
    <span className="items-center font-mono text-muted-foreground inline-flex gap-1.5">
      <UsdcLogo className="size-5" />
      {formatPrice(fee)} USDC
    </span>
  );
}

/** One offered service in the agent detail grid. */
export function ServiceCard({
  service,
  onShowPrompt,
}: {
  service: AgentService;
  onShowPrompt: (service: AgentService) => void;
}) {
  return (
    <Card className="h-full w-full">
      <div className="flex flex-col gap-3 px-(--card-spacing)">
        <CardTitle className="truncate">{service.name}</CardTitle>
        <CardDescription className="line-clamp-2">{service.description}</CardDescription>
      </div>
      <CardFooter className="mt-auto justify-end gap-2">
        <ServiceFee fee={service.fee} />
        <Button
          size="sm"
          aria-label={`Show prompt for the ${service.name} service`}
          onClick={() => onShowPrompt(service)}
        >
          Run
        </Button>
      </CardFooter>
    </Card>
  );
}

/** Loading placeholder matching the `ServiceCard` layout — card shell with skeleton content. */
export function ServiceCardSkeleton() {
  return (
    <Card aria-hidden className="h-full w-full">
      <div className="flex flex-col gap-3 px-(--card-spacing)">
        <Skeleton className="h-5 w-2/3" />
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      </div>
      <CardFooter className="mt-auto justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Skeleton className="size-5 rounded-full" />
          <Skeleton className="h-4 w-20" />
        </div>
        <Skeleton className="h-8 w-14 rounded-lg" />
      </CardFooter>
    </Card>
  );
}
