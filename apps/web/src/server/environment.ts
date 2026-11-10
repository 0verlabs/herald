import { environmentFromCloudflareEnv } from "@herald/core";
import { createServerFn } from "@tanstack/react-start";

/**
 * The Herald environment this Worker was built for. vite.config.ts inlines
 * CLOUDFLARE_ENV at build time; it is unset in local dev (testnet).
 */
export const readEnvironment = () => environmentFromCloudflareEnv(process.env.CLOUDFLARE_ENV);

export const getEnvironment = createServerFn({ method: "GET" }).handler(() => readEnvironment());
