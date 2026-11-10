import { Hono } from "hono";

// The x402 paywall on /weather lands in #3, using `accepts()` from @hrld/x402.
const app = new Hono<{ Bindings: CloudflareBindings }>();

app.get("/health", (c) => c.json({ status: "ok", service: "weather-api" }));

app.get("/weather", (c) => c.json({ city: "Jakarta", temperatureC: 31, conditions: "Humid" }));

export default app;
