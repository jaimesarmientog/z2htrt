/**
 * crawl.ts — builds the "app inventory" that generate.ts feeds to Claude.
 *
 * Scope (per design doc Section 4): auth flow (admin login) and booking
 * flow (web + API) on the Restful-Booker Platform.
 *
 * Verified end-to-end against the live app (see inline notes for what's
 * confirmed vs. still-generic heuristics).
 */

import { chromium, type Page } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import openapiTS, { astToString } from "openapi-typescript";

const APP_URL = process.env.TESTRIGOR_APP_URL ?? "https://automationintesting.online";
const OPENAPI_SPEC_PATH = path.join(process.cwd(), "docs", "restful-booker.openapi.yaml");
const OUTPUT_PATH = path.join(process.cwd(), "tmp", "inventory.json");

interface FieldInfo {
  label: string;
  role: string;
  type?: string;
}

interface ActionInfo {
  label: string;
  role: string;
}

interface ValidationObservation {
  scenario: string;
  inputs: Record<string, string>;
  resultText: string | null;
}

interface WebFlow {
  name: string;
  url: string;
  fields: FieldInfo[];
  actions: ActionInfo[];
  observedValidation: ValidationObservation[];
  notes?: string[];
}

/**
 * Enumerates visible form controls on the current page. Best-effort
 * accessible name resolution: aria-label > associated <label> > closest
 * <label> ancestor > placeholder > name attribute. Confirmed working
 * against both the admin login form and the guest-details booking form.
 */
async function enumerateFields(page: Page): Promise<FieldInfo[]> {
  const fields: FieldInfo[] = [];
  const inputs = page.locator("input, textarea, select");
  const count = await inputs.count();

  for (let i = 0; i < count; i++) {
    const el = inputs.nth(i);
    const type = (await el.getAttribute("type")) ?? "text";
    if (type === "hidden" || type === "submit" || type === "button") continue;

    const label = await el.evaluate((node: HTMLInputElement) => {
      const ariaLabel = node.getAttribute("aria-label");
      if (ariaLabel) return ariaLabel;
      if (node.id) {
        const labelEl = document.querySelector(`label[for="${node.id}"]`);
        if (labelEl?.textContent) return labelEl.textContent.trim();
      }
      const closestLabel = node.closest("label");
      if (closestLabel?.textContent) return closestLabel.textContent.trim();
      return node.getAttribute("placeholder") ?? node.getAttribute("name") ?? "(unlabeled field)";
    });

    fields.push({ label, role: "textbox", type });
  }

  return fields;
}

/**
 * Enumerates clickable actions. Checks aria-label first, then visible
 * text, then a value attribute. Confirmed working against both flows.
 */
async function enumerateActions(page: Page): Promise<ActionInfo[]> {
  const actions: ActionInfo[] = [];
  const buttons = page.locator('button, [role="button"], input[type="submit"]');
  const count = await buttons.count();

  for (let i = 0; i < count; i++) {
    const el = buttons.nth(i);
    const ariaLabel = await el.getAttribute("aria-label");
    const innerText = (await el.innerText().catch(() => "")).trim();
    const valueAttr = await el.getAttribute("value");
    const label = ariaLabel || innerText || valueAttr || "(unlabeled action)";
    actions.push({ label: label.trim(), role: "button" });
  }

  return actions;
}

/**
 * Waits for a validation/error element to actually become visible,
 * rather than a fixed delay + one-shot check. Confirmed working: the
 * app uses an ARIA live region ([role="alert"]) that exists empty in the
 * DOM before being populated, plus a ".alert" class on the same/adjacent
 * element once text is set — trying candidates in sequence and skipping
 * empty matches handles this correctly.
 */
async function captureFeedbackText(page: Page): Promise<string | null> {
  const candidateSelectors = ['[role="alert"]', ".alert", ".error", '[class*="error"]', '[class*="invalid"]'];

  for (const selector of candidateSelectors) {
    const appeared = await page
      .waitForSelector(selector, { timeout: 2000, state: "visible" })
      .then(() => true)
      .catch(() => false);

    if (appeared) {
      const text = (await page.locator(selector).first().innerText().catch(() => "")).trim();
      if (text) return text;
    }
  }

  return null;
}

/**
 * Confirmed flow: from the homepage, click the "Admin" nav link (not a
 * direct URL — this SPA's router doesn't reliably pick up a hash present
 * on initial load). Login button targeted by name, not position — an
 * earlier draft's positional .first() was wrongly clicking an unrelated
 * button. Empty-submit and invalid-credentials cases both produce the
 * same "Invalid credentials" message — confirmed real app behavior, not
 * a capture bug.
 */
async function crawlAdminLogin(page: Page): Promise<WebFlow> {
  await page.goto(APP_URL, { waitUntil: "networkidle" });

  const adminNavLink = page.getByRole("link", { name: /^admin$/i }).first();
  if (!(await adminNavLink.count())) {
    throw new Error('crawlAdminLogin: no "Admin" nav link found on homepage.');
  }
  await adminNavLink.click();
  await page.waitForTimeout(500);

  const fields = await enumerateFields(page);
  const actions = await enumerateActions(page);
  const observedValidation: ValidationObservation[] = [];

  const loginButton = page.getByRole("button", { name: /login/i }).first();
  const textInputs = page.locator('input:not([type="hidden"])');

  if (await loginButton.count()) {
    await loginButton.click().catch(() => {});
    observedValidation.push({
      scenario: "empty submit",
      inputs: {},
      resultText: await captureFeedbackText(page),
    });
  }

  const inputCount = await textInputs.count();
  if (inputCount >= 2) {
    const label0 = fields[0]?.label ?? "username";
    const label1 = fields[1]?.label ?? "password";
    await textInputs.nth(0).fill("invalid_user").catch(() => {});
    await textInputs.nth(1).fill("invalid_pass").catch(() => {});
    await loginButton.click().catch(() => {});
    observedValidation.push({
      scenario: "invalid credentials",
      inputs: { [label0]: "invalid_user", [label1]: "invalid_pass" },
      resultText: await captureFeedbackText(page),
    });
  }

  return {
    name: "Admin Login",
    url: page.url(),
    fields,
    actions,
    observedValidation,
    notes: [
      'A "Logout" button is always present in the nav, even before authentication — it is not ' +
        "auth-gated and simply returns to the homepage. Don't treat its presence as evidence of " +
        "a successful login in generated test cases.",
      'Empty-submit and invalid-credentials submissions both return the exact same "Invalid ' +
        'credentials" message — the backend does not distinguish missing fields from wrong ' +
        "values. Generated negative test cases for this form should expect identical error text " +
        "in both scenarios, not different ones.",
    ],
  };
}

/**
 * Targets react-big-calendar's actual DOM structure (rbc-* classes),
 * confirmed via live dev tools inspection: each selectable day is a
 * <button class="rbc-button-link"> inside <div class="rbc-date-cell">.
 * Cells belonging to the previous/next month (grid padding) carry
 * rbc-off-range and are excluded. Waits for the calendar to actually
 * render (confirmed: this SPA fetches room availability data after
 * navigation, so a flat delay was previously too short/flaky).
 *
 * ⚠️ REVIEW: skips the first 2 in-range days as a buffer in case the
 * widget disables "today" or same-day booking — this offset itself
 * hasn't been specifically verified, only that clicking days at these
 * positions has worked reliably across every real run so far.
 */
async function pickCalendarDays(page: Page): Promise<boolean> {
  const calendarAppeared = await page
    .waitForSelector(".rbc-date-cell", { timeout: 10000 })
    .then(() => true)
    .catch(() => false);

  if (!calendarAppeared) return false;

  const inRangeDayButtons = page.locator(".rbc-date-cell:not(.rbc-off-range) button.rbc-button-link");
  const inRangeCount = await inRangeDayButtons.count();

  if (inRangeCount < 4) return false;

  await inRangeDayButtons.nth(2).click().catch(() => {});
  await page.waitForTimeout(200);
  await inRangeDayButtons.nth(3).click().catch(() => {});

  return true;
}

/**
 * Confirmed flow: homepage -> click exact-case "Book now" (lowercase
 * "now") on a room card — NOT the homepage's own "Book Now" button,
 * which only scrolls to the rooms section and would otherwise be
 * ambiguously matched by a case-insensitive selector -> react-big-
 * calendar widget appears -> click a check-in day, then a check-out day
 * -> click "Reserve Now" -> guest-details form appears (Firstname,
 * Lastname, Email, Phone, placeholder-labeled, submit button also
 * labeled "Reserve Now", with a "Cancel" button immediately after it).
 */
async function crawlBookingCreation(page: Page): Promise<WebFlow> {
  await page.goto(APP_URL, { waitUntil: "networkidle" });

  const bookNowButton = page.getByRole("button", { name: "Book now", exact: true }).first();
  const bookNowLink = page.getByRole("link", { name: "Book now", exact: true }).first();

  if (await bookNowButton.count()) {
    await bookNowButton.click();
  } else if (await bookNowLink.count()) {
    await bookNowLink.click();
  } else {
    throw new Error('crawlBookingCreation: no exact-case "Book now" control found on homepage.');
  }

  await page.waitForTimeout(500);

  const pickedDates = await pickCalendarDays(page);
  if (!pickedDates) {
    throw new Error(
      "crawlBookingCreation: could not identify two clickable in-range calendar day cells " +
        "after the calendar rendered. Inspect the real markup if the calendar's structure has changed."
    );
  }

  const reserveButton = page.getByRole("button", { name: /reserve now/i }).first();
  if (!(await reserveButton.count())) {
    throw new Error('crawlBookingCreation: no "Reserve Now" button found after date selection.');
  }
  await reserveButton.click();
  await page.waitForTimeout(500);

  const fields = await enumerateFields(page);
  const actions = await enumerateActions(page);
  const observedValidation: ValidationObservation[] = [];

  const submitButton = page.getByRole("button", { name: /reserve now/i }).first();

  // Negative case only: empty submit. We deliberately never submit a
  // fully valid booking here — that would create a real booking on the
  // shared public demo instance on every crawl run. Happy-path execution
  // is testRigor's job at actual test-run time, not discovery time.
  if (await submitButton.count()) {
    await submitButton.click().catch(() => {});
    observedValidation.push({
      scenario: "empty submit",
      inputs: {},
      resultText: await captureFeedbackText(page),
    });
  }

  return {
    name: "Booking Creation",
    url: APP_URL,
    fields,
    actions,
    observedValidation,
    notes: [
      'The "Reserve Now" button appears twice in sequence: once to advance from the calendar to ' +
        'the guest-details form, and again to submit that form. Generated test cases must ' +
        'synchronize between the two clicks using testRigor\'s retry-wait pattern, since the ' +
        'calendar view has no "Cancel" button and the guest-details form does — e.g.: ' +
        '`wait 1 sec up to 10 times until page contains "Cancel" below "Reserve Now"`.',
      'The homepage has a "Book Now" button (both words capitalized) that only scrolls to the ' +
        'rooms section, and separate "Book now" buttons (lowercase "now") on each room card that ' +
        'actually navigate to that room\'s booking page. Generated test cases must use testRigor\'s ' +
        '`click exactly "Book now"` to hit the correct one, since a plain `click "Book now"` would ' +
        'be ambiguous between the two.',
    ],
  };
}

async function buildApiSurface() {
  const rawSpec = await fs.readFile(OPENAPI_SPEC_PATH, "utf8");
  const parsedSpec = yaml.load(rawSpec);

  const ast = await openapiTS(parsedSpec as Parameters<typeof openapiTS>[0]);
  const generatedTypes = astToString(ast);

  return {
    specSource: "docs/restful-booker.openapi.yaml (hand-authored — see file header)",
    generatedTypes,
    endpoints: [
      { method: "POST", path: "/auth", authRequired: false },
      { method: "POST", path: "/booking", authRequired: false },
      {
        method: "PUT",
        path: "/booking/{id}",
        authRequired: true,
        authNote: "Requires Cookie: token=<token> from POST /auth",
      },
      {
        method: "DELETE",
        path: "/booking/{id}",
        authRequired: true,
        authNote: "Requires Cookie: token=<token> from POST /auth",
      },
    ],
  };
}

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const webFlows: WebFlow[] = [];

  try {
    webFlows.push(await crawlAdminLogin(page));
  } catch (err) {
    console.error("Admin login crawl failed:", err);
  }

  try {
    webFlows.push(await crawlBookingCreation(page));
  } catch (err) {
    console.error("Booking creation crawl failed:", err);
  }

  await browser.close();

  const apiSurface = await buildApiSurface();

  const inventory = {
    generatedAt: new Date().toISOString(),
    webFlows,
    apiSurface,
  };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(inventory, null, 2), "utf8");

  console.log(`Inventory written to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
}); 