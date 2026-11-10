import { listPayments } from "@herald/core/server";
import { createDb } from "@herald/db";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireSession } from "./auth";
import { readHeraldEnv } from "./herald-env";

/** Payments per page of the Payments page. */
const PAYMENTS_PAGE_SIZE = 25;

/** One page of the signed-in Provider's payment log, newest first. */
export const getPaymentLog = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .validator(z.object({ page: z.number().int().positive() }))
  .handler(async ({ context, data }) => {
    return listPayments(createDb(env.DB), {
      providerId: context.session.providerId,
      env: readHeraldEnv(),
      page: data.page,
      pageSize: PAYMENTS_PAGE_SIZE,
    });
  });
