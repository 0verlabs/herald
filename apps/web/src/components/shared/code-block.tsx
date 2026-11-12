import { FileCodeIcon, FileKeyIcon, TerminalIcon } from "lucide-react";
import {
  CodeBlock as CodeBlockRoot,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from "@/components/ui/code-block";
import { useHighlightedCode } from "@/hooks/use-highlighted-code";

const icons = { bash: TerminalIcon, dotenv: FileKeyIcon, typescript: FileCodeIcon };

/** A read-only block of code, highlighted, with its file name and a copy button. */
export function CodeBlock(props: {
  label: string;
  code: string;
  language: keyof typeof icons;
  lineNumbers?: boolean;
}) {
  const lines = useHighlightedCode(props.code, props.language);
  const Icon = icons[props.language];

  return (
    <CodeBlockRoot className="bg-muted/30">
      <CodeBlockHeader>
        <CodeBlockTitle className="font-mono text-xs font-normal">
          <Icon />
          {props.label}
        </CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={props.code} aria-label={`Copy ${props.label}`} />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent lineNumbers={props.lineNumbers} className="max-h-[32rem] text-[0.8rem]">
        {lines.map((line, index) => (
          <CodeBlockLine key={index}>{line}</CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlockRoot>
  );
}
