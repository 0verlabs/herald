#!/usr/bin/env node
import { createProgram } from "./index.ts";
import { auth } from "./commands/auth.ts";

const program = createProgram();

program.addCommand(auth).parse();
