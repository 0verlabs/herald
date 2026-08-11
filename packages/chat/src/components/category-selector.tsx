import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@hrld/ui/components/select";
import { ToggleGroup, ToggleGroupItem } from "@hrld/ui/components/toggle-group";

import type { AgentCategoryFilter } from "../config/agents";
import { AGENT_CATEGORY_FILTER_LABELS, AGENT_CATEGORY_FILTERS } from "../config/agents";

interface CategorySelectorProps {
  value: AgentCategoryFilter;
  onValueChange: (category: AgentCategoryFilter) => void;
}

/**
 * Category filter with two variants that swap per breakpoint. On desktop it
 * renders a toggle pill bar spanning the top grid row; on mobile it renders a
 * `Select` that sits beside the sort control. Grid placement matches the
 * `/agents` controls grid (`grid-cols-[1fr_auto]`).
 */
export function CategorySelector({ value, onValueChange }: CategorySelectorProps) {
  return (
    <>
      <ToggleGroup
        aria-label="Filter agents by category"
        value={[value]}
        // Single-select: ignore the empty selection so one pill stays active.
        onValueChange={(next) => {
          if (next[0]) onValueChange(next[0] as AgentCategoryFilter);
        }}
        variant="outline"
        spacing={1.5}
        className="hidden w-full flex-wrap justify-start md:col-span-2 md:flex"
      >
        {AGENT_CATEGORY_FILTERS.map((category) => (
          <ToggleGroupItem key={category} value={category}>
            {AGENT_CATEGORY_FILTER_LABELS[category]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Select
        // Labels for the closed trigger, resolved without mounting the popup.
        items={AGENT_CATEGORY_FILTER_LABELS}
        value={value}
        onValueChange={(next) => {
          if (next) onValueChange(next);
        }}
      >
        <SelectTrigger
          aria-label="Filter agents by category"
          className="col-start-1 row-start-1 w-full min-w-0 md:hidden"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {AGENT_CATEGORY_FILTERS.map((category) => (
              <SelectItem key={category} value={category}>
                {AGENT_CATEGORY_FILTER_LABELS[category]}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </>
  );
}
