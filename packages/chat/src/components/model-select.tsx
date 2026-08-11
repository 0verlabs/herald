import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@hrld/ui/components/dropdown-menu";
import { InputGroupButton } from "@hrld/ui/components/input-group";
import { ChevronDown } from "lucide-react";

import type { ModelId } from "../types/model";
import { MODEL_IDS, MODELS } from "../config/model";
import { ModelProviderLogo } from "./model-provider-logo";

interface ModelSelectProps {
  value: ModelId;
  onValueChange: (model: ModelId) => void;
  disabled?: boolean;
}

export function ModelSelect({ value, onValueChange, disabled }: ModelSelectProps) {
  return (
    // Non-modal: selecting re-renders this subtree mid-close, which
    // strands the modal backdrop and blocks clicks on the whole page.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger disabled={disabled} render={<InputGroupButton size="sm" />}>
        <ModelProviderLogo provider={MODELS[value].provider} className="text-foreground" />
        {MODELS[value].label}
        <ChevronDown />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-auto min-w-52 max-h-50">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => onValueChange(next as ModelId)}
        >
          {MODEL_IDS.map((id) => (
            <DropdownMenuRadioItem key={id} value={id} closeOnClick>
              <ModelProviderLogo provider={MODELS[id].provider} className="text-foreground" />
              {MODELS[id].label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
