import { ArrowUpRightIcon } from "lucide-react";
import { shortenMiddle } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * A link to a transaction on a block explorer, shortened, opening in a new
 * tab. With no URL, the shortened hash alone.
 */
export function ExplorerLink(props: {
  url: string | null;
  hash: string;
  label?: string;
  className?: string;
}) {
  const text = props.label ?? shortenMiddle(props.hash, 6, 4);
  if (!props.url) {
    return (
      <span className={cn("font-mono text-xs", props.className)} title={props.hash}>
        {text}
      </span>
    );
  }
  return (
    <a
      href={props.url}
      target="_blank"
      rel="noreferrer"
      title={props.hash}
      className={cn(
        "group/link inline-flex items-center gap-0.5 font-mono text-xs underline decoration-border underline-offset-4 transition-colors hover:text-primary hover:decoration-primary",
        props.className,
      )}
    >
      {text}
      <ArrowUpRightIcon
        aria-hidden
        className="size-3.5 transition-transform group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5"
      />
      <span className="sr-only">(opens the block explorer)</span>
    </a>
  );
}
