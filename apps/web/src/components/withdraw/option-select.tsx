import type { ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** One choice in an `OptionSelect`: a logo, a name and a line under it. */
export type Option = {
  value: string;
  label: string;
  icon: ReactNode;
  hint?: ReactNode;
  /** Shown at the end of the row, such as a balance. */
  aside?: ReactNode;
  disabled?: boolean;
};

function OptionRow({ option }: { option: Option }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      {option.icon}
      <span className="flex min-w-0 flex-1 flex-col text-left leading-tight">
        <span className="truncate font-medium">{option.label}</span>
        {option.hint ? (
          <span className="truncate text-xs text-muted-foreground">{option.hint}</span>
        ) : null}
      </span>
      {option.aside ? (
        <span className="amount shrink-0 text-sm text-muted-foreground">{option.aside}</span>
      ) : null}
    </span>
  );
}

/**
 * A select whose options carry a logo and a hint, for coins, networks and
 * destinations. Shows "Select" until something is chosen.
 */
export function OptionSelect(props: {
  id: string;
  value: string | null;
  options: Option[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const selected = props.options.find((o) => o.value === props.value);

  return (
    <Select
      value={props.value}
      onValueChange={(value) => {
        if (typeof value === "string") props.onChange(value);
      }}
      items={props.options.map((o) => ({ value: o.value, label: o.label }))}
      disabled={props.disabled}
    >
      <SelectTrigger id={props.id} className="w-full px-3 data-[size=default]:h-12">
        <SelectValue placeholder={props.placeholder ?? "Select"}>
          {selected ? <OptionRow option={selected} /> : undefined}
        </SelectValue>
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} className="p-1">
        <SelectGroup>
          {props.options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              disabled={option.disabled}
              className="py-2 pr-9 pl-2"
            >
              <OptionRow option={option} />
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
