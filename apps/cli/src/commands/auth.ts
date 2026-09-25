import { spawn } from "node:child_process";
import pc from "picocolors";
import { zodCommand } from "zod-commander";
import {
  clearCredentials,
  getValidAccessToken,
  saveCredentials,
  toCredentials,
} from "../lib/credentials.ts";
import { pollForTokens, requestDeviceAuthorization } from "../lib/privy.ts";
import { err, isJson, ok } from "../utils/result.ts";

const login = zodCommand({
  name: "login",
  description: "Authorize this machine through your browser",
  action: async () => {
    const json = isJson(login);

    const device = await requestDeviceAuthorization().catch((error: Error) => error);
    if (device instanceof Error) return err(device, json);

    // Keep stdout clean for JSON output; progress goes to stderr.
    const print = json ? console.error : console.log;
    print(`Visit:  ${pc.cyan(device.verification_uri_complete)}`);
    print(`Code:   ${pc.bold(device.user_code)}`);
    print("");
    print("Waiting for authorization in the browser…");
    openBrowser(device.verification_uri_complete);

    const tokens = await pollForTokens(device.device_code, device.interval).catch(
      (error: Error) => error,
    );
    if (tokens instanceof Error) return err(tokens, json);

    await saveCredentials(toCredentials(tokens));
    ok({ message: "Logged in" }, json);
  },
});

const logout = zodCommand({
  name: "logout",
  description: "Remove stored credentials from this machine",
  action: async () => {
    await clearCredentials();
    ok({ message: "Logged out" }, isJson(logout));
  },
});

const status = zodCommand({
  name: "status",
  description: "Show authentication status",
  action: async () => {
    const json = isJson(status);

    const accessToken = await getValidAccessToken();
    if (!accessToken) return err("Not logged in. Run `hrld auth login`.", json);

    ok({ status: "authenticated" }, json);
  },
});

export const auth = zodCommand({
  name: "auth",
  description: "Authenticate Herald ACP",
})
  .addCommand(login)
  .addCommand(logout)
  .addCommand(status);

function openBrowser(url: string): void {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];

  const child = spawn(command, args, { stdio: "ignore", detached: true });
  child.on("error", () => {});
  child.unref();
}
