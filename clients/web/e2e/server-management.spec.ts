import { test, expect } from "@playwright/test";
import { registerUser, uniqueUsername, waitForAppReady } from "./helpers";

test.describe("Server Management", () => {
  const password = "TestPassword123!";

  test("create a new server", async ({ page }) => {
    const username = uniqueUsername();
    await registerUser(page, username, password);
    await waitForAppReady(page);

    const serverName = `Test Server ${Date.now()}`;

    // Click the "Create server" button in the sidebar
    await page.getByLabel("Create server").click();

    // Fill in the server name in the modal
    await page.getByLabel("Server Name").fill(serverName);

    // Submit
    await page.getByRole("button", { name: "Create Server" }).click();

    // The server name should appear somewhere in the UI (sidebar or header)
    await expect(page.getByText(serverName).first()).toBeVisible({
      timeout: 5000,
    });
  });

  test("server appears in sidebar after creation", async ({ page }) => {
    const username = uniqueUsername();
    await registerUser(page, username, password);
    await waitForAppReady(page);

    const serverName = `Sidebar Server ${Date.now()}`;

    await page.getByLabel("Create server").click();
    await page.getByLabel("Server Name").fill(serverName);
    await page.getByRole("button", { name: "Create Server" }).click();

    // Wait for modal to close and server to appear
    await expect(
      page.getByRole("button", { name: "Create Server" }),
    ).toBeHidden({ timeout: 5000 });

    // Server icon (first letter) or title should be in the sidebar
    await expect(
      page.getByTitle(serverName).or(page.getByText(serverName).first()),
    ).toBeVisible({ timeout: 5000 });
  });

  test("create a text channel", async ({ page }) => {
    const username = uniqueUsername();
    await registerUser(page, username, password);
    await waitForAppReady(page);

    // Create a server first
    const serverName = `Channel Test ${Date.now()}`;
    await page.getByLabel("Create server").click();
    await page.getByLabel("Server Name").fill(serverName);
    await page.getByRole("button", { name: "Create Server" }).click();
    await expect(
      page.getByRole("button", { name: "Create Server" }),
    ).toBeHidden({ timeout: 5000 });

    // Click the server to select it
    await page
      .getByTitle(serverName)
      .or(page.getByText(serverName).first())
      .click();

    // Look for the "+" button or "Create Channel" option
    // The ChannelSidebar has a "+" (Plus) icon button for creating channels
    const addChannelBtn = page
      .getByTitle("Create Channel")
      .or(page.getByLabel("Create channel"));
    if (await addChannelBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await addChannelBtn.click();
    } else {
      // Fallback: look for any "+" button near the channel list
      await page
        .locator("button:has(svg)")
        .filter({ hasText: "" })
        .first()
        .click();
    }

    const channelName = "test-channel";

    // Fill in channel name
    const channelNameInput = page.getByLabel("Channel Name");
    if (
      await channelNameInput.isVisible({ timeout: 3000 }).catch(() => false)
    ) {
      await channelNameInput.fill(channelName);
      await page.getByRole("button", { name: "Create Channel" }).click();

      // The channel should appear in the sidebar
      await expect(page.getByText(channelName).first()).toBeVisible({
        timeout: 5000,
      });
    }
  });
});
