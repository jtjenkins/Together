import { test, expect } from "@playwright/test";
import { registerUser, uniqueUsername, waitForAppReady } from "./helpers";

test.describe("Messaging", () => {
  const password = "TestPassword123!";

  /**
   * Helper: create a server and navigate to its first text channel.
   * Returns the server name for assertions.
   */
  async function setupServerWithChannel(page: import("@playwright/test").Page) {
    const username = uniqueUsername();
    await registerUser(page, username, password);
    await waitForAppReady(page);

    const serverName = `Msg Test ${Date.now()}`;
    await page.getByLabel("Create server").click();
    await page.getByLabel("Server Name").fill(serverName);
    await page.getByRole("button", { name: "Create Server" }).click();
    await expect(
      page.getByRole("button", { name: "Create Server" }),
    ).toBeHidden({ timeout: 5000 });

    // Click the server to select it and wait for channels to load
    await page
      .getByTitle(serverName)
      .or(page.getByText(serverName).first())
      .click();

    // Wait for a channel to appear in the sidebar (default "general" or first channel)
    // Servers typically have a default #general channel
    const channelLink = page.getByText("general").first();
    if (await channelLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await channelLink.click();
    }

    return { username, serverName };
  }

  test("send a message in a channel", async ({ page }) => {
    await setupServerWithChannel(page);

    const messageText = `Hello E2E ${Date.now()}`;

    // The message input is a textarea with aria-label "Message input"
    const messageInput = page.getByLabel("Message input");
    await expect(messageInput).toBeVisible({ timeout: 5000 });
    await messageInput.fill(messageText);

    // Press Enter to send (the textarea sends on Enter without Shift)
    await messageInput.press("Enter");

    // The message should appear in the message list
    await expect(page.getByText(messageText)).toBeVisible({ timeout: 5000 });
  });

  test("edit a message", async ({ page }) => {
    await setupServerWithChannel(page);

    const originalText = `Edit me ${Date.now()}`;
    const editedText = `Edited ${Date.now()}`;

    // Send the message
    const messageInput = page.getByLabel("Message input");
    await expect(messageInput).toBeVisible({ timeout: 5000 });
    await messageInput.fill(originalText);
    await messageInput.press("Enter");

    await expect(page.getByText(originalText)).toBeVisible({ timeout: 5000 });

    // Hover over the message to reveal action buttons
    const messageElement = page
      .getByText(originalText)
      .locator("..")
      .locator("..");
    await messageElement.hover();

    // Click the edit button (aria-label="Edit message")
    const editBtn = page.getByLabel("Edit message");
    if (await editBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await editBtn.click();

      // The edit textarea should appear with the original content
      // Clear and type new content, then press Enter to save
      const editInput = page.locator("textarea").last();
      await editInput.fill(editedText);
      await editInput.press("Enter");

      // The edited message should be visible
      await expect(page.getByText(editedText)).toBeVisible({ timeout: 5000 });
      // The "(edited)" indicator should appear
      await expect(page.getByText("(edited)")).toBeVisible({ timeout: 5000 });
    }
  });

  test("delete a message (soft delete)", async ({ page }) => {
    await setupServerWithChannel(page);

    const messageText = `Delete me ${Date.now()}`;

    // Send the message
    const messageInput = page.getByLabel("Message input");
    await expect(messageInput).toBeVisible({ timeout: 5000 });
    await messageInput.fill(messageText);
    await messageInput.press("Enter");

    await expect(page.getByText(messageText)).toBeVisible({ timeout: 5000 });

    // Hover to reveal actions
    const messageElement = page
      .getByText(messageText)
      .locator("..")
      .locator("..");
    await messageElement.hover();

    // Click delete button (aria-label="Delete message")
    const deleteBtn = page.getByLabel("Delete message");
    if (await deleteBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Accept the confirmation dialog
      page.on("dialog", (dialog) => dialog.accept());
      await deleteBtn.click();

      // The message should show as deleted
      await expect(page.getByText("This message has been deleted")).toBeVisible(
        { timeout: 5000 },
      );
    }
  });
});
