import { Calculator } from "lucide-react";

import type { ToolRenderer } from "../../lib/ai/tool-renderers";

/** Mirrors the agent's calculator tool input/output (packages/agent/src/tools/calculator.ts). */
interface CalculationInput {
  operation?: "add" | "subtract" | "multiply" | "divide";
  a?: number;
  b?: number;
}

interface CalculationOutput {
  result?: number;
}

const OPERATION_SYMBOLS: Record<NonNullable<CalculationInput["operation"]>, string> = {
  add: "+",
  subtract: "−",
  multiply: "×",
  divide: "÷",
};

function formatExpression(input: CalculationInput | undefined) {
  // Input streams in incrementally; render nothing until it's complete.
  if (
    input?.operation === undefined ||
    input.a === undefined ||
    input.b === undefined ||
    !(input.operation in OPERATION_SYMBOLS)
  ) {
    return null;
  }
  return `${input.a.toLocaleString()} ${OPERATION_SYMBOLS[input.operation]} ${input.b.toLocaleString()}`;
}

export const calculatorToolRenderer: ToolRenderer<CalculationInput, CalculationOutput> = {
  icon: Calculator,
  label: () => "Calculator",
  renderSummary: (input) => formatExpression(input),
  renderInput: (input) => {
    const expression = formatExpression(input);
    if (!expression) return null;
    return <p className="font-mono text-sm tabular-nums">{expression}</p>;
  },
  renderOutput: (output, input) => {
    if (output.result === undefined) return null;
    const expression = formatExpression(input);
    return (
      <p className="font-mono text-sm tabular-nums">
        {expression ? `${expression} = ` : ""}
        <span className="font-semibold">{output.result.toLocaleString()}</span>
      </p>
    );
  },
  approvalMessage: (input) => {
    const expression = formatExpression(input);
    return expression
      ? `This calculation exceeds the auto-run threshold. Compute ${expression}?`
      : "This calculation exceeds the auto-run threshold. Run it?";
  },
};
