import type { ReactNode } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const sizes = {
  xs: "size-5 text-[0.55rem]",
  sm: "size-6 text-[0.6rem]",
  md: "size-8 text-[0.7rem]",
} as const;

type Size = keyof typeof sizes;

/**
 * A network's logo file in public/logos/networks, from its label: the first
 * word, lowercased ("Base Sepolia" is base.svg). A network without a file
 * falls back to the first two letters of its name.
 */
const logoOf = (label: string) => `/logos/networks/${label.split(" ")[0]?.toLowerCase() ?? ""}.svg`;

/** A network's logo, as a round avatar. */
export function NetworkLogo({
  label,
  size = "sm",
  className,
  src,
}: {
  label: string;
  size?: Size;
  className?: string;
  /** A logo file to use instead of the one derived from the label. */
  src?: string;
}) {
  return (
    <Avatar aria-hidden="true" className={cn(sizes[size], className)}>
      <AvatarImage src={src ?? logoOf(label)} alt="" />
      <AvatarFallback className="bg-secondary font-semibold text-secondary-foreground">
        {label.slice(0, 2)}
      </AvatarFallback>
    </Avatar>
  );
}

/** A network's logo on its own, its name in a tooltip: for lists and tables. */
export function NetworkAvatar({
  label,
  size = "sm",
  className,
  logo,
}: {
  label: string;
  size?: Size;
  className?: string;
  /** What to show instead of the network's logo, such as NEAR Intents' own. `size` doesn't apply to it. */
  logo?: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span />}
        aria-label={label}
        className={cn(
          "inline-flex shrink-0 rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          className,
        )}
      >
        {logo ?? <NetworkLogo label={label} size={size} />}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Several networks as overlapping avatars, each named in its tooltip. */
export function NetworkStack({ labels, size = "sm" }: { labels: string[]; size?: Size }) {
  return (
    <span className="flex *:not-first:-ml-1.5">
      {labels.map((label) => (
        <NetworkAvatar
          key={label}
          label={label}
          size={size}
          className="ring-2 ring-background hover:z-10 focus-visible:z-10"
        />
      ))}
    </span>
  );
}

/** A network's logo and name, inline: where the name is the point, such as a picker. */
export function NetworkName({ label, className }: { label: string; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      <NetworkLogo label={label} size="xs" />
      <span className="truncate">{label}</span>
    </span>
  );
}
