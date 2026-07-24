import { tool } from "ai";
import { z } from "zod";

export const calculationInputSchema = z.object({
  operation: z.enum(["add", "subtract", "multiply", "divide"]),
  a: z.number(),
  b: z.number(),
});

export type CalculationInput = z.infer<typeof calculationInputSchema>;

export const calculationOutputSchema = z.object({
  result: z.number(),
});

function evaluate({ operation, a, b }: CalculationInput): number {
  switch (operation) {
    case "add":
      return a + b;
    case "subtract":
      return a - b;
    case "multiply":
      return a * b;
    case "divide": {
      if (b === 0) {
        throw new Error("Division by zero is not allowed");
      }
      return a / b;
    }
  }
}

function magnitude(input: CalculationInput, result: number): number {
  return Math.max(Math.abs(input.a), Math.abs(input.b), Math.abs(result));
}

const APPROVAL_THRESHOLD = 1_000;

export function createCalculatorTools() {
  return {
    calculate: tool({
      description:
        `Perform a basic arithmetic calculation (add, subtract, multiply, divide). ` +
        `Calculations where any operand or the result has a magnitude greater than ` +
        `${APPROVAL_THRESHOLD} require explicit user approval before they run.`,
      inputSchema: calculationInputSchema,
      outputSchema: calculationOutputSchema,
      // Threshold approval: small calculations run instantly, anything larger
      // pauses for the user. Invalid inputs (division by zero) skip approval
      // so `execute` surfaces the error to the model directly.
      needsApproval: (input) => {
        try {
          return magnitude(input, evaluate(input)) > APPROVAL_THRESHOLD;
        } catch {
          return false;
        }
      },
      execute: (input) => ({ result: evaluate(input) }),
    }),
  };
}
