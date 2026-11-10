import type { ApiKey, Provider } from "@herald/core";
import { authenticateApiKey, checkReceivingAddress, recordPayment } from "@herald/core/server";
import { createDb } from "@herald/db";
import { PaymentPayloadV2Schema, PaymentRequirementsV2Schema } from "@x402/core/schemas";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import { heraldEnvOf } from "./chains.ts";
import { createFacilitator } from "./facilitator.ts";
import { createRootKeyGuard } from "./root-keys.ts";

type AppEnv = {
  Bindings: CloudflareBindings;
  Variables: { apiKey: ApiKey; provider: Provider };
};

/** A Herald-level refusal, as JSON: `{ error, message }`. */
function refuse(c: Context, status: 400 | 401 | 403 | 429 | 503, error: string, message: string) {
  return c.json({ error, message }, status);
}

/**
 * Herald's x402 facilitator: `GET /supported` (public), and `POST /verify`
 * and `POST /settle` for a Provider's Herald API key. Each app instance keeps
 * its own MPC root-key check result.
 */
export function createApp() {
  const checkRootKeys = createRootKeyGuard();
  const app = new Hono<AppEnv>();

  app.get("/health", async (c) => {
    await c.env.DB.prepare("select 1").first();
    return c.json({ status: "ok", service: "facilitator", heraldEnv: heraldEnvOf(c.env) });
  });

  app.get("/supported", async (c) => c.json(createFacilitator(c.env).getSupported()));

  const requireApiKey = createMiddleware<AppEnv>(async (c, next) => {
    const header = c.req.header("Authorization");
    const secret = header?.match(/^Bearer\s+(\S+)$/i)?.[1];
    const auth = await authenticateApiKey(createDb(c.env.DB), {
      secret,
      env: heraldEnvOf(c.env),
    });
    if (!auth.ok) return refuse(c, 401, `${auth.reason}_api_key`, auth.message);
    c.set("apiKey", auth.apiKey);
    c.set("provider", auth.provider);
    await next();
  });

  const paymentRoute = [bodyLimit({ maxSize: 64 * 1024 }), requireApiKey] as const;

  app.post("/verify", ...paymentRoute, async (c) => {
    const request = await readPaymentRequest(c);
    if (!request.ok) return request.response;
    const { paymentPayload, paymentRequirements } = request;
    const facilitator = createFacilitator(c.env);
    return c.json(await facilitator.verify(paymentPayload, paymentRequirements));
  });

  app.post("/settle", ...paymentRoute, async (c) => {
    const apiKey = c.get("apiKey");
    const { success: withinLimit } = await c.env.SETTLE_RATE_LIMITER.limit({
      key: String(apiKey.id),
    });
    if (!withinLimit) {
      return refuse(c, 429, "rate_limited", "At most 60 settlements per minute per API key.");
    }
    const rootKeys = await checkRootKeys(heraldEnvOf(c.env), c.env.NEAR_RPC_URL);
    if (!rootKeys.ok) return refuse(c, 503, rootKeys.error, rootKeys.message);

    const request = await readPaymentRequest(c);
    if (!request.ok) return request.response;
    const { paymentPayload, paymentRequirements } = request;

    const facilitator = createFacilitator(c.env);
    const result = await facilitator.settle(paymentPayload, paymentRequirements);
    console.log(
      JSON.stringify({
        event: "settle",
        success: result.success,
        network: result.network,
        transaction: result.transaction,
        errorReason: result.errorReason,
        apiKeyId: apiKey.id,
      }),
    );
    if (result.success) {
      // The payment has happened on-chain whatever happens here, so a failed
      // write is logged rather than reported to the Provider as a failure.
      try {
        await recordPayment(createDb(c.env.DB), {
          providerId: c.get("provider").id,
          apiKeyId: apiKey.id,
          network: paymentRequirements.network,
          asset: paymentRequirements.asset,
          amount: result.amount ?? paymentRequirements.amount,
          buyerAddress: result.payer ?? "",
          txHash: result.transaction,
          resourceUrl: paymentPayload.resource?.url ?? null,
        });
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "record_payment_failed",
            network: result.network,
            transaction: result.transaction,
            error: String(error),
          }),
        );
      }
    }
    return c.json(result);
  });

  app.onError((error, c) => {
    console.error(
      JSON.stringify({ event: "unhandled_error", path: c.req.path, error: String(error) }),
    );
    return c.json({ error: "internal_error", message: "Herald's facilitator hit an error." }, 500);
  });

  return app;
}

const PaymentRequestBodySchema = z.object({
  x402Version: z.literal(2, "Herald's facilitator supports x402 v2 only."),
  paymentPayload: z.unknown(),
  paymentRequirements: z.unknown(),
});

type PaymentRequest =
  | { ok: true; paymentPayload: PaymentPayload; paymentRequirements: PaymentRequirements }
  | { ok: false; response: Response };

/**
 * Parses an x402 v2 verify or settle body and checks that it pays the
 * authenticated Provider's own Receiving Address.
 */
async function readPaymentRequest(c: Context<AppEnv>): Promise<PaymentRequest> {
  const invalid = (message: string): PaymentRequest => ({
    ok: false,
    response: refuse(c, 400, "invalid_request", message),
  });
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    return invalid("The body must be JSON.");
  }
  const envelope = PaymentRequestBodySchema.safeParse(json);
  if (!envelope.success) {
    return invalid(envelope.error.issues[0]?.message ?? "Not an x402 v2 request body.");
  }
  const body = envelope.data;
  const paymentPayload = PaymentPayloadV2Schema.safeParse(body.paymentPayload);
  const paymentRequirements = PaymentRequirementsV2Schema.safeParse(body.paymentRequirements);
  if (!paymentPayload.success || !paymentRequirements.success) {
    return invalid("paymentPayload and paymentRequirements must be x402 v2 objects.");
  }

  const check = checkReceivingAddress(
    c.get("provider"),
    heraldEnvOf(c.env),
    paymentRequirements.data,
  );
  if (!check.ok) {
    const status = check.reason === "pay_to_mismatch" ? 403 : 400;
    return { ok: false, response: refuse(c, status, check.reason, check.message) };
  }
  if (check.network.kind === "solana") {
    return {
      ok: false,
      response: refuse(
        c,
        400,
        "unsupported_network",
        "Herald's facilitator doesn't settle Solana payments yet.",
      ),
    };
  }
  // The stock schemas type `network` as a plain string; the stock facilitator
  // takes the CAIP-2 template type. checkReceivingAddress has matched it to a
  // Herald network above.
  return {
    ok: true,
    paymentPayload: paymentPayload.data as PaymentPayload,
    paymentRequirements: paymentRequirements.data as PaymentRequirements,
  };
}
