import type { ComponentProps } from "react";

import type { ModelProvider } from "../types/model";
import Alibaba from "../assets/logos/alibaba.svg?react";
import Anthropic from "../assets/logos/anthropic.svg?react";
import DeepSeek from "../assets/logos/deepseek.svg?react";
import MiniMax from "../assets/logos/minimax.svg?react";
import MoonshotAI from "../assets/logos/moonshotai.svg?react";
import OpenAI from "../assets/logos/openai.svg?react";
import ZhipuAI from "../assets/logos/zhipuai.svg?react";

interface ModelProviderLogoProps extends ComponentProps<"svg"> {
  provider: ModelProvider;
}

export function ModelProviderLogo({ provider, ...props }: ModelProviderLogoProps) {
  switch (provider) {
    case "alibaba":
      return <Alibaba {...props} />;
    case "anthropic":
      return <Anthropic {...props} />;
    case "deepseek":
      return <DeepSeek {...props} />;
    case "minimax":
      return <MiniMax {...props} />;
    case "moonshotai":
      return <MoonshotAI {...props} />;
    case "openai":
      return <OpenAI {...props} />;
    case "zhipuai":
      return <ZhipuAI {...props} />;
    default:
      return null;
  }
}
