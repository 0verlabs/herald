#!/usr/bin/env node
import { createProgram } from "./index.ts";
import { auth } from "./commands/auth.ts";
import { wallet } from "./commands/wallet.ts";
import { whoami } from "./commands/whoami.ts";

const program = createProgram();

program.addCommand(auth).addCommand(wallet).addCommand(whoami).parse();
