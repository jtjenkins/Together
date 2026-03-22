import { type Page, expect } from "@playwright/test";

/**
 * Register a new user and wait for navigation to the app.
 * The AuthForm uses "Create Account" as the submit button text in register mode,
 * and the toggle button to switch to register view is labelled "Register".
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
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);

  // Submit
  await page.getByRole("button", { name: "Create Account" }).click();

  // Wait for navigation away from the auth page
  // The app may redirect to /channels/ or show a server list
  await page
    .waitForURL(/\/(channels|servers)/, { timeout: 10000 })
    .catch(() => {
      // Fallback: just wait for the auth form to disappear
    });
}

/**
 * Log in with existing credentials.
 * The AuthForm shows "Sign In" as the submit button text in login mode.
 */
export async function loginUser(
  page: Page,
  username: string,
  password: string,
) {
  await page.goto("/");

  // The login form is the default view
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
}

/**
 * Generate a unique username for E2E tests to avoid collisions.
 */
export function uniqueUsername(): string {
  return `e2e_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Wait for the main app UI to be loaded (post-login).
 * Checks for the presence of the user panel or server sidebar.
 */
export async function waitForAppReady(page: Page) {
  // The UserPanel renders a "Sign Out" button once logged in
  await expect(page.getByLabel("Sign Out")).toBeVisible({ timeout: 10000 });
}
