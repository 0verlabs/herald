import { Command } from "commander";
import pkg from "../package.json" with { type: "json" };

export function createProgram() {
  return new Command()
    .name("hrld")
    .description(pkg.description)
    .version(pkg.version)
    .option("--json", "Output results as JSON");
}
