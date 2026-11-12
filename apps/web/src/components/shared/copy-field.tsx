import { CheckIcon, CopyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { useCopy } from "@/hooks/use-copy";

/** A read-only value, such as an address, with a button that copies it. */
export function CopyField({ label, value }: { label: string; value: string }) {
  const { copied, copy } = useCopy(value);

  return (
    <InputGroup>
      <InputGroupInput
        aria-label={label}
        className="font-mono text-[0.8rem]"
        readOnly
        value={value}
        onFocus={(event) => event.currentTarget.select()}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton aria-label={copied ? `${label} copied` : `Copy ${label}`} onClick={copy}>
          {copied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
          {copied ? "Copied" : "Copy"}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}

/** A small icon button that copies `value`, for tables and tight rows. */
export function CopyButton({
  label,
  value,
  size = "icon-xs",
}: {
  label: string;
  value: string;
  size?: "icon-xs" | "icon-sm";
}) {
  const { copied, copy } = useCopy(value);

  return (
    <Button
      variant="ghost"
      size={size}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      onClick={copy}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  );
}
