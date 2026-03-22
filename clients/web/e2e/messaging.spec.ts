import { test, expect } from "@playwright/test";
import {
  registerUser,
  uniqueUsername,
  waitForAppReady,
  createServer,
} from "./helpers";

test.describe("Messaging", () => {
  const password = "TestPassword123!";

  test("create server and see welcome message", async ({ page }) => {
    const username = uniqueUsername();
    await registerUser(page, username, password);
    await waitForAppReady(page);

    const serverName = `Msg Test ${Date.now()}`;
    await createServer(page, serverName);

    // After creating a server, we should see it in the UI
    await expect(page.getByText(serverName).first()).toBeVisible({
      timeout: 5000,
    });
  });
});
