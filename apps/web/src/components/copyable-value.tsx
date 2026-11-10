import { CheckIcon, CopyIcon } from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { useCopy } from "@/hooks/use-copy";

/** A read-only value, such as an address, with a button that copies it. */
export function CopyableValue({ label, value }: { label: string; value: string }) {
  const { copied, copy } = useCopy(value);

  return (
    <InputGroup>
      <InputGroupInput
        aria-label={label}
        className="font-mono"
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
