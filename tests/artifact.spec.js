import { expect, test } from "@playwright/test";

test("loads without browser or network errors", async ({ page }) => {
  const problems = [];
  const report = (kind, detail) => problems.push(`${kind}: ${detail}`);

  page.on("console", (message) => {
    if (message.type() === "error") {
      report("Console error", message.text());
    }
  });
  page.on("pageerror", (error) => report("Uncaught exception", error.message));
  page.on("requestfailed", (request) => report("Request failed", `${request.method()} ${request.url()}`));
  page.on("response", (response) => {
    if (response.status() >= 400) {
      report("HTTP error", `${response.status()} ${response.url()}`);
    }
  });

  await page.goto("/");
  await expect(page.locator("#root > *").first()).toBeAttached();
  expect(problems).toEqual([]);
});


