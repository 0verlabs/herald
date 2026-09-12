import { ApiClient } from "./lib/api";

export interface GlobalVariables {
  apiClient: ApiClient;
}

export interface Env<TVariables extends object = {}> {
  Bindings: CloudflareBindings;
  Variables: GlobalVariables & TVariables;
}
