import { getProviderOverview } from "@herald/core/server";
import { createDb } from "@herald/db";
import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { requireSession } from "./auth";
import { readHeraldEnv } from "./herald-env";

/** The signed-in Provider's account and Receiving Addresses. */
export const getOverview = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .handler(async ({ context }) => {
    const overview = await getProviderOverview(createDb(env.DB), {
      providerId: context.session.providerId,
      env: readHeraldEnv(),
    });
    if (!overview) throw redirect({ to: "/sign-in" });
    return overview;
  });
