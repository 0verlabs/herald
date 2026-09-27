#!/usr/bin/env node
import { createProgram } from "./index.ts";
import { auth } from "./commands/auth.ts";
import { storage } from "./commands/storage.ts";
import { wallet } from "./commands/wallet.ts";
import { whoami } from "./commands/whoami.ts";

const program = createProgram();

program.addCommand(auth).addCommand(wallet).addCommand(storage).addCommand(whoami).parse();
