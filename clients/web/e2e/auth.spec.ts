import { test, expect } from "@playwright/test";
import {
  registerUser,
  loginUser,
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

    // Register first
    await registerUser(page, username, password);
    await waitForAppReady(page);

    // Log out
    await page.getByLabel("Sign Out").click();

    // Should be back on the login page
    await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();

    // Log back in
    await loginUser(page, username, password);
    await waitForAppReady(page);

    await expect(page.getByText(username)).toBeVisible();
  });

  test("logout returns to login page", async ({ page }) => {
    const username = uniqueUsername();
    await registerUser(page, username, password);
    await waitForAppReady(page);

    await page.getByLabel("Sign Out").click();

    // Should see the login form heading
    await expect(page.getByText("Welcome back!")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
  });

  test("wrong password shows error", async ({ page }) => {
    const username = uniqueUsername();

    // Register the user
    await registerUser(page, username, password);
    await waitForAppReady(page);

    // Log out
    await page.getByLabel("Sign Out").click();

    // Try to login with wrong password
    await loginUser(page, username, "WrongPassword999!");

    // Should show an error alert
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 5000 });
  });
});
