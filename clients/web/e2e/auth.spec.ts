import { test, expect } from "@playwright/test";
import {
  registerUser,
  loginUser,
  logout,
  uniqueUsername,
  waitForAppReady,
} from "./helpers";

test.describe("Authentication", () => {
  const password = "TestPassword123!";

  test("register a new user and land on the app", async ({ page }) => {
    const username = uniqueUsername();
    await registerUser(page, username, password);
    await waitForAppReady(page);

    // The user panel should show the username
    await expect(page.getByText(username)).toBeVisible();
  });

  test("login with registered credentials", async ({ page }) => {
    const username = uniqueUsername();
    await registerUser(page, username, password);
    await waitForAppReady(page);

    // Log out
    await logout(page);

    // Log back in
    await loginUser(page, username, password);
    await waitForAppReady(page);

    await expect(page.getByText(username)).toBeVisible();
  });

  test("logout returns to login page", async ({ page }) => {
    const username = uniqueUsername();
    await registerUser(page, username, password);
    await waitForAppReady(page);

    await logout(page);

    // Should see the login form
    await expect(
      page.getByRole("heading", { name: "Welcome back!" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
  });

  test("wrong password shows error", async ({ page }) => {
    const username = uniqueUsername();
    await registerUser(page, username, password);
    await waitForAppReady(page);

    await logout(page);

    // Try to login with wrong password
    await page.getByRole("textbox", { name: "Username" }).fill(username);
    await page
      .getByRole("textbox", { name: "Password" })
      .fill("WrongPassword999!");
    await page.getByRole("button", { name: "Sign In" }).click();

    // Should show an error
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 5000 });
  });
});
