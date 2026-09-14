import { hc } from "hono/client";
import { ApiClientType } from "@hrld/api/rpc";

export type ApiClient = ReturnType<typeof hc<ApiClientType>>;
