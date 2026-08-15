import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@hrld/ui/components/select";
import { ToggleGroup, ToggleGroupItem } from "@hrld/ui/components/toggle-group";

import type { AgentTagFilter } from "../config/agents";
import { AGENT_TAG_FILTER_LABELS, AGENT_TAG_FILTERS } from "../config/agents";

interface TagSelectorProps {
  value: AgentTagFilter;
  onValueChange: (tag: AgentTagFilter) => void;
}

/**
 * Tag filter with two variants that swap per breakpoint. On desktop it
 * renders a toggle pill bar spanning the top grid row; on mobile it renders a
 * `Select` that sits beside the sort control. Grid placement matches the
 * `/agents` controls grid (`grid-cols-[1fr_auto]`).
 */
export function TagSelector({ value, onValueChange }: TagSelectorProps) {
  return (
    <>
      <ToggleGroup
        aria-label="Filter agents by tag"
        value={[value]}
        // Single-select: ignore the empty selection so one pill stays active.
        onValueChange={(next) => {
          if (next[0]) onValueChange(next[0] as AgentTagFilter);
        }}
        variant="outline"
        spacing={1.5}
        className="hidden w-full flex-wrap justify-start md:col-span-2 md:flex"
      >
        {AGENT_TAG_FILTERS.map((tag) => (
          <ToggleGroupItem key={tag} value={tag}>
            {AGENT_TAG_FILTER_LABELS[tag]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Select
        // Labels for the closed trigger, resolved without mounting the popup.
        items={AGENT_TAG_FILTER_LABELS}
        value={value}
        onValueChange={(next) => {
          if (next) onValueChange(next);
        }}
      >
        <SelectTrigger
          aria-label="Filter agents by tag"
          className="col-start-1 row-start-1 w-full min-w-0 md:hidden"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {AGENT_TAG_FILTERS.map((tag) => (
              <SelectItem key={tag} value={tag}>
                {AGENT_TAG_FILTER_LABELS[tag]}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </>
  );
}
