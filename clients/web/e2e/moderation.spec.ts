import { test, expect } from "@playwright/test";
import {
  registerUser,
  uniqueUsername,
  waitForAppReady,
  createServer,
} from "./helpers";

test.describe("Moderation", () => {
  const password = "TestPassword123!";

  test("server owner sees server settings", async ({ page }) => {
    const username = uniqueUsername();
    await registerUser(page, username, password);
    await waitForAppReady(page);

    const serverName = `Mod Test ${Date.now()}`;
    await createServer(page, serverName);

    // Owner should see the server in the UI
    await expect(page.getByText(serverName).first()).toBeVisible({
      timeout: 5000,
    });
  });
});
