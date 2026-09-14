import { Sdk as Erc8004 } from "./lib/subgraphs/__generated/erc-8004";
import { Sdk as Erc8183 } from "./lib/subgraphs/__generated/erc-8183";

export interface GlobalVariables {
  erc8004: Erc8004;
  erc8183: Erc8183;
}

export interface Env<TVariables extends object = {}> {
  Bindings: CloudflareBindings;
  Variables: GlobalVariables & TVariables;
}
