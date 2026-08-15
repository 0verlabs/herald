// `src/env.ts` parses the environment at import time, so the fixture must be in
// place before the app module is loaded.
const fixture = {
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/herald_test",
  PRIVY_APP_ID: "test-app-id",
  PRIVY_APP_SECRET: "test-app-secret",
  PRIVY_AUTHORIZATION_ID: "test-authorization-id",
  PRIVY_AUTHORIZATION_PRIVATE_KEY: "test-authorization-private-key",
  CLERK_PUBLISHABLE_KEY: "pk_test_Y2xlcmsudGVzdC5sY2wuZGV2JA",
  CLERK_SECRET_KEY: "sk_test_secret",
  CLERK_TELEMETRY_DISABLED: "1",
  ANTHROPIC_API_URL: "https://api.anthropic.com/v1",
  OPENAI_API_URL: "https://api.openai.com/v1",
  DEEPSEEK_API_URL: "https://api.deepseek.com/v1",
  MOONSHOTAI_API_URL: "https://api.moonshot.ai/v1",
  MINIMAX_API_URL: "https://api.minimax.io/v1",
  ALIBABA_API_URL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  ZHIPUAI_API_URL: "https://api.z.ai/api/paas/v4",
  ANTHROPIC_API_KEY: "test-key",
  OPENAI_API_KEY: "test-key",
  DEEPSEEK_API_KEY: "test-key",
  MOONSHOTAI_API_KEY: "test-key",
  MINIMAX_API_KEY: "test-key",
  ALIBABA_API_KEY: "test-key",
  ZHIPUAI_API_KEY: "test-key",
};

for (const [key, value] of Object.entries(fixture)) process.env[key] = value;
