import { CheckIcon, CopyIcon } from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { useCopy } from "@/hooks/use-copy";

/** A read-only block of code, such as a config file, with a button that copies it. */
export function CopyableCode({ label, code }: { label: string; code: string }) {
  const { copied, copy } = useCopy(code);

  return (
    <InputGroup>
      <InputGroupTextarea
        aria-label={label}
        className="font-mono"
        readOnly
        spellCheck={false}
        wrap="off"
        value={code}
      />
      <InputGroupAddon align="block-start" className="border-b">
        <InputGroupText className="font-mono">{label}</InputGroupText>
        <InputGroupButton
          className="ml-auto"
          aria-label={copied ? `${label} copied` : `Copy ${label}`}
          onClick={copy}
        >
          {copied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
          {copied ? "Copied" : "Copy"}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}
