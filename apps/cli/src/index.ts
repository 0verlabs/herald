import { program } from "commander";
import pkg from "../package.json" with { type: "json" };

export function createProgram() {
  return program
    .name("hrld")
    .description(pkg.description)
    .version(pkg.version)
    .option("--json", "Output results as JSON");
}
