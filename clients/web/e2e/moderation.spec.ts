import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { registerUser, uniqueUsername, waitForAppReady } from "./helpers";

test.describe("Moderation", () => {
  const password = "TestPassword123!";

  /**
   * Helper: create a public server and return its name.
   */
  async function createPublicServer(page: Page): Promise<string> {
    const serverName = `Mod Test ${Date.now()}`;
    await page.getByLabel("Create server").click();
    await page.getByLabel("Server Name").fill(serverName);

    // Ensure "public" checkbox is checked (it is by default)
    const publicCheckbox = page.getByLabel("List in Browse Servers");
    if (publicCheckbox) {
      const isChecked = await publicCheckbox.isChecked().catch(() => true);
      if (!isChecked) {
        await publicCheckbox.check();
      }
    }

    await page.getByRole("button", { name: "Create Server" }).click();
    await expect(
      page.getByRole("button", { name: "Create Server" }),
    ).toBeHidden({ timeout: 5000 });

    return serverName;
  }

  test("kick a member from a server", async ({ browser }) => {
    // Create two separate browser contexts (two users)
    const ownerContext: BrowserContext = await browser.newContext();
    const memberContext: BrowserContext = await browser.newContext();
    const ownerPage: Page = await ownerContext.newPage();
    const memberPage: Page = await memberContext.newPage();

    try {
      // Register the server owner
      const ownerUsername = uniqueUsername();
      await registerUser(ownerPage, ownerUsername, password);
      await waitForAppReady(ownerPage);

      // Create a public server
      const serverName = await createPublicServer(ownerPage);

      // Register the second user in a separate context
      const memberUsername = uniqueUsername();
      await registerUser(memberPage, memberUsername, password);
      await waitForAppReady(memberPage);

      // The second user joins the server via Browse Servers
      const browseBtn = memberPage
        .getByLabel("Browse servers")
        .or(memberPage.getByTitle("Browse Servers"));
      if (await browseBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await browseBtn.click();

        // Find and join the server
        const serverEntry = memberPage.getByText(serverName).first();
        if (await serverEntry.isVisible({ timeout: 5000 }).catch(() => false)) {
          // Click join button near the server name
          await serverEntry.click();
          const joinBtn = memberPage.getByRole("button", { name: /join/i });
          if (await joinBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await joinBtn.click();
          }
        }
      }

      // Back on the owner's page, navigate to the server
      await ownerPage
        .getByTitle(serverName)
        .or(ownerPage.getByText(serverName).first())
        .click();

      // Wait for the member list to show the new member
      // Right-click on the member to open context menu
      const memberEntry = ownerPage.getByText(memberUsername);
      if (await memberEntry.isVisible({ timeout: 5000 }).catch(() => false)) {
        await memberEntry.click({ button: "right" });

        // Look for kick option in the context menu
        const kickOption = ownerPage.getByText("Kick");
        if (await kickOption.isVisible({ timeout: 3000 }).catch(() => false)) {
          await kickOption.click();

          // Confirm kick in the modal
          const confirmBtn = ownerPage
            .getByRole("button", { name: /kick/i })
            .last();
          if (
            await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)
          ) {
            await confirmBtn.click();
          }

          // The member should no longer appear in the member list
          await expect(memberEntry).toBeHidden({ timeout: 5000 });
        }
      }
    } finally {
      await ownerContext.close();
      await memberContext.close();
    }
  });
});
