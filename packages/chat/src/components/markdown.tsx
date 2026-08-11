import type { Components } from "react-markdown";
import { cn } from "@hrld/ui/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const components: Components = {
  // Wide tables scroll inside their own container instead of the page.
  table: ({ node: _node, ...props }) => (
    <div className="typeset-scroll">
      <table {...props} />
    </div>
  ),
};

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("typeset typeset-message", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
