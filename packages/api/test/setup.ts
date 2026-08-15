// `src/env.ts` parses the environment at import time, so the fixture must be in
// place before the app module is loaded.
const fixture = {
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/herald_test",
  PRIVY_APP_ID: "test-app-id",
  PRIVY_APP_SECRET: "test-app-secret",
  PRIVY_WEBHOOK_SIGNING_SECRET: "whsec_dGVzdC1zaWduaW5nLXNlY3JldA==",
};

for (const [key, value] of Object.entries(fixture)) process.env[key] = value;
