import type { HeraldEnv } from "@herald/core";
import { Badge } from "@/components/ui/badge";
import { environmentLabels, environmentNotes } from "@/lib/environment";

/** Test mode or Live, so nobody mistakes test money for real money. */
export function EnvironmentBadge({ heraldEnv }: { heraldEnv: HeraldEnv }) {
  return (
    <Badge
      variant={heraldEnv === "mainnet" ? "success" : "warning"}
      title={environmentNotes[heraldEnv]}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {environmentLabels[heraldEnv]}
    </Badge>
  );
}
