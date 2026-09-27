#!/usr/bin/env node
import { createProgram } from "./index.ts";
import { auth } from "./commands/auth.ts";
import { storage } from "./commands/storage.ts";
import { wallet } from "./commands/wallet.ts";

const program = createProgram();

program.addCommand(auth).addCommand(storage).addCommand(wallet).parse();
