import { zodCommand } from "zod-commander";
import { isJson, ok } from "../utils/result.ts";

export const auth = zodCommand({
  name: "auth",
  description: "Authenticate Herald ACP",
  action: async (_opts, _cmd) => {
    const json = isJson(auth);

    ok({ message: "ok" }, json);
  },
});
