import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60000,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // serial to avoid DB conflicts between tests
  use: {
    baseURL: "http://localhost:5173",
    headless: true,
    screenshot: "only-on-failure",
    // Each test gets a fresh browser context (no shared cookies/localStorage)
    storageState: undefined,
  },
  webServer: [
    {
      command: "cd ../../server && cargo run",
      url: "http://localhost:8080/health",
      timeout: 120000,
      reuseExistingServer: !process.env.CI,
      env: {
        DATABASE_URL:
          process.env.DATABASE_URL ||
          "postgresql://together:together_dev_password@localhost:5432/together_dev",
        JWT_SECRET: "e2e-test-secret-must-be-32-characters-long!!",
        APP_ENV: "development",
        SERVER_HOST: "0.0.0.0",
        SERVER_PORT: "8080",
        RUST_LOG: "together_server=warn",
      },
    },
    {
      command: "npm run dev",
      url: "http://localhost:5173",
      timeout: 30000,
      reuseExistingServer: !process.env.CI,
    },
  ],
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
