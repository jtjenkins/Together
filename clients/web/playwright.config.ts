import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  use: {
    baseURL: "http://localhost:5173",
    headless: true,
    screenshot: "only-on-failure",
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
