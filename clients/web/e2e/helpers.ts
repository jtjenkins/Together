import { type Page } from "@playwright/test";

/**
 * Generate a unique username for E2E tests to avoid collisions.
 */
export function uniqueUsername(): string {
  return `e2e_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Register a new user and wait for the app to load.
 */
export async function registerUser(
  page: Page,
  username: string,
  password: string,
) {
  await page.goto("/");

  // Switch to register view
  await page.getByRole("button", { name: "Register" }).click();

  // Fill in the registration form
  await page.getByRole("textbox", { name: "Username" }).fill(username);
  await page.getByRole("textbox", { name: "Password" }).fill(password);

  // Submit
  await page.getByRole("button", { name: "Create Account" }).click();

  // Wait for app to load — Sign Out button appears in sidebar
  await page
    .getByRole("button", { name: "Sign Out" })
    .waitFor({ timeout: 15000 });

  // Close the Browse Servers dialog if it appeared on first login
  const skipButton = page.getByRole("button", { name: "Skip for now" });
  if (await skipButton.isVisible()) {
    await skipButton.click();
  }
}

/**
 * Log in with existing credentials and wait for app to load.
 */
export async function loginUser(
  page: Page,
  username: string,
  password: string,
) {
  await page.goto("/");

  await page.getByRole("textbox", { name: "Username" }).fill(username);
  await page.getByRole("textbox", { name: "Password" }).fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();

  // Wait for app to load
  await page
    .getByRole("button", { name: "Sign Out" })
    .waitFor({ timeout: 15000 });

  const skipButton = page.getByRole("button", { name: "Skip for now" });
  if (await skipButton.isVisible()) {
    await skipButton.click();
  }
}

/**
 * Log out by clearing localStorage and navigating to root.
 * Direct button click is unreliable due to WebSocket reconnection causing instability.
 */
export async function logout(page: Page) {
  await page.evaluate(() => localStorage.clear());
  await page.goto("/");
  // Wait for login page to appear
  await page
    .getByRole("heading", { name: "Welcome back!" })
    .waitFor({ timeout: 10000 });
}

/**
 * Create a server via the Create Server dialog.
 */
export async function createServer(page: Page, serverName: string) {
  // Click the "Create server" button in the sidebar (the + icon)
  await page.getByRole("button", { name: "Create server" }).click();
  await page
    .getByRole("heading", { name: "Create a Server" })
    .waitFor({ timeout: 5000 });
  await page.getByRole("textbox", { name: "Server Name" }).fill(serverName);
  // Click the submit button inside the dialog
  await page
    .getByRole("dialog", { name: "Create a Server" })
    .getByRole("button", { name: "Create Server" })
    .click();
  // Wait for dialog to close
  await page.waitForTimeout(1500);
}

/**
 * Wait for the main app UI to be loaded (post-login).
 */
export async function waitForAppReady(page: Page) {
  await page
    .getByRole("button", { name: "Sign Out" })
    .waitFor({ timeout: 10000 });
}
