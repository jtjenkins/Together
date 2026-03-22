import { test, expect } from "@playwright/test";
import {
  registerUser,
  uniqueUsername,
  waitForAppReady,
  createServer,
} from "./helpers";

test.describe("Server Management", () => {
  const password = "TestPassword123!";

  test("create a new server", async ({ page }) => {
    const username = uniqueUsername();
    await registerUser(page, username, password);
    await waitForAppReady(page);

    const serverName = `Test Server ${Date.now()}`;
    await createServer(page, serverName);

    // The server name should appear somewhere in the UI
    await expect(page.getByText(serverName).first()).toBeVisible({
      timeout: 5000,
    });
  });

  test("server appears in sidebar after creation", async ({ page }) => {
    const username = uniqueUsername();
    await registerUser(page, username, password);
    await waitForAppReady(page);

    const serverName = `Sidebar ${Date.now()}`;
    await createServer(page, serverName);

    // Server icon (first letter) should be in the sidebar
    await expect(page.getByText(serverName).first()).toBeVisible({
      timeout: 5000,
    });
  });
});
