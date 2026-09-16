/**
 * crawl.ts — builds the "app inventory" that generate.ts feeds to Claude.
 *
 * Scope (per design doc Section 4): auth flow (admin login) and booking
 * flow (web + API) on the Restful-Booker Platform.
 *
 * Web discovery mixes confirmed selectors/behavior (verified via live
 * screenshots and dev tools inspection) with generic, semantic-first
 * enumeration for parts of the DOM not yet inspected directly. Flagged
 * inline wherever an assumption hasn't been verified against the live app.
 */

import { chromium, type Page } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import openapiTS, { astToString } from "openapi-typescript";

const APP_URL = process.env.TESTRIGOR_APP_URL ?? "https://automationintesting.online";
const OPENAPI_SPEC_PATH = path.join(process.cwd(), "docs", "restful-booker.openapi.yaml");
const OUTPUT_PATH = path.join(process.cwd(), "tmp", "inventory.json");

// ⚠️ REVIEW: hash-routing path assumed from the Restful-Booker Platform's
// known convention. Confirm against the live app before relying on this.
const ADMIN_LOGIN_URL = `${APP_URL}/#/admin`;
const BOOKING_URL = APP_URL;

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
  // Interaction gotchas that don't fit the other fields — e.g. required
  // synchronization steps between actions, quirks a flat field/action
  // list wouldn't otherwise capture. Consumed by generate.ts as extra
  // grounding context for the affected flow.
  notes?: string[];
}

/**
 * Enumerates visible form controls on the current page. Best-effort
 * accessible name resolution: aria-label > associated <label> > closest
 * <label> ancestor > placeholder > name attribute.
 *
 * Confirmed against the real guest-details form (Firstname, Lastname,
 * Email, Phone — all placeholder-labeled, no <label> elements), so the
 * placeholder fallback path is verified for that form specifically. Not
 * yet verified against the admin login form's markup.
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
 * Enumerates clickable actions the same generic way.
 *
 * ⚠️ REVIEW: generic heuristic. Confirmed to at least correctly find
 * "Reserve Now" and "Cancel" per the real guest-details form, but not
 * exhaustively verified beyond that.
 */
async function enumerateActions(page: Page): Promise<ActionInfo[]> {
  const actions: ActionInfo[] = [];
  const buttons = page.locator('button, [role="button"], input[type="submit"]');
  const count = await buttons.count();

  for (let i = 0; i < count; i++) {
    const el = buttons.nth(i);
    const label =
      (await el.innerText().catch(() => "")) || (await el.getAttribute("value")) || "(unlabeled action)";
    actions.push({ label: label.trim(), role: "button" });
  }

  return actions;
}

/**
 * ⚠️ REVIEW: heuristic, not a verified selector for the real app's
 * validation/error markup. Tries the most accessible pattern first
 * (role="alert"), then falls back to common class-based error
 * containers. Inspect actual output on first real run and adjust here
 * if nothing is captured.
 */
async function captureFeedbackText(page: Page): Promise<string | null> {
  const alertLocator = page.getByRole("alert");
  if (await alertLocator.count()) {
    const text = (await alertLocator.first().innerText()).trim();
    if (text) return text;
  }

  const fallbackSelectors = [".alert", ".error", '[class*="error"]', '[class*="invalid"]'];
  for (const selector of fallbackSelectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      const text = (await locator.innerText().catch(() => "")).trim();
      if (text) return text;
    }
  }

  return null;
}

async function crawlAdminLogin(page: Page): Promise<WebFlow> {
  await page.goto(ADMIN_LOGIN_URL, { waitUntil: "networkidle" });

  const fields = await enumerateFields(page);
  const actions = await enumerateActions(page);
  const observedValidation: ValidationObservation[] = [];

  const submitButton = page.locator('button, [role="button"], input[type="submit"]').first();
  const textInputs = page.locator('input:not([type="hidden"])');

  // Negative case 1: empty submit.
  if (await submitButton.count()) {
    await submitButton.click().catch(() => {});
    await page.waitForTimeout(500);
    observedValidation.push({
      scenario: "empty submit",
      inputs: {},
      resultText: await captureFeedbackText(page),
    });
  }

  // Negative case 2: invalid credentials. Confirmed: this form has
  // exactly two fields, username and password, in that order — so
  // indexing the first two text inputs directly is safe here.
  const inputCount = await textInputs.count();
  if (inputCount >= 2) {
    const label0 = fields[0]?.label ?? "username";
    const label1 = fields[1]?.label ?? "password";
    await textInputs.nth(0).fill("invalid_user").catch(() => {});
    await textInputs.nth(1).fill("invalid_pass").catch(() => {});
    await submitButton.click().catch(() => {});
    await page.waitForTimeout(500);
    observedValidation.push({
      scenario: "invalid credentials",
      inputs: { [label0]: "invalid_user", [label1]: "invalid_pass" },
      resultText: await captureFeedbackText(page),
    });
  }

  return { name: "Admin Login", url: ADMIN_LOGIN_URL, fields, actions, observedValidation };
}

/**
 * Targets react-big-calendar's actual DOM structure (rbc-* classes),
 * confirmed via live dev tools inspection: each selectable day is a
 * <button class="rbc-button-link"> inside <div class="rbc-date-cell">.
 * Cells belonging to the previous/next month (grid padding) carry
 * rbc-off-range and are excluded.
 *
 * ⚠️ REVIEW: skips the first 2 in-range days as a buffer in case the
 * widget disables "today" or same-day booking — this is a guess to
 * reduce the odds of clicking a disabled cell, not a confirmed rule.
 * If the first click silently fails, this offset is the first thing to
 * adjust.
 */
async function pickCalendarDays(page: Page): Promise<boolean> {
  const dayButtons = page.locator(".rbc-date-cell:not(.rbc-off-range) button.rbc-button-link");
  const count = await dayButtons.count();

  if (count < 4) return false; // not enough in-range days to safely pick two with a buffer

  await dayButtons.nth(2).click().catch(() => {});
  await page.waitForTimeout(200);
  await dayButtons.nth(3).click().catch(() => {});

  return true;
}

/**
 * Confirmed flow: homepage -> click "Book now" on a room -> react-big-
 * calendar widget appears -> click a check-in day, then a check-out day
 * -> click "Reserve Now" -> guest-details form appears (Firstname,
 * Lastname, Email, Phone, placeholder-labeled, submit button also
 * labeled "Reserve Now", with a "Cancel" button immediately after it).
 *
 * ⚠️ REVIEW: only the calendar step (pickCalendarDays) and the guest-
 * details form's fields/buttons have been verified against real
 * screenshots. The "Book now" control's exact accessible name on the
 * homepage room card, and the validation/error markup shown after an
 * empty submit, are still unverified — adjust after the first real run
 * if either doesn't match.
 */
async function crawlBookingCreation(page: Page): Promise<WebFlow> {
  await page.goto(BOOKING_URL, { waitUntil: "networkidle" });

  const bookNowButton = page.getByRole("button", { name: /book now/i }).first();
  const bookNowLink = page.getByRole("link", { name: /book now/i }).first();

  if (await bookNowButton.count()) {
    await bookNowButton.click();
  } else if (await bookNowLink.count()) {
    await bookNowLink.click();
  } else {
    throw new Error('crawlBookingCreation: no "Book now" control found on homepage.');
  }

  await page.waitForTimeout(500);

  const pickedDates = await pickCalendarDays(page);
  if (!pickedDates) {
    throw new Error(
      "crawlBookingCreation: could not identify two clickable in-range calendar day cells " +
        "(.rbc-date-cell:not(.rbc-off-range) button.rbc-button-link). Inspect the real markup " +
        "if the calendar's structure has changed."
    );
  }

  // Confirmed: this first "Reserve Now" click sits below the calendar's
  // price summary and advances from the calendar to the guest-details
  // form. The form's own submit button carries the same accessible name
  // — see the note below on why that's safe for our crawl (only one is
  // ever visible at a time) and what generated test cases need to do
  // about it (synchronize between the two clicks).
  const reserveButton = page.getByRole("button", { name: /reserve now/i }).first();
  if (!(await reserveButton.count())) {
    throw new Error('crawlBookingCreation: no "Reserve Now" button found after date selection.');
  }
  await reserveButton.click();
  await page.waitForTimeout(500);

  // Guest-details form should now be visible.
  const fields = await enumerateFields(page);
  const actions = await enumerateActions(page);
  const observedValidation: ValidationObservation[] = [];

  // Confirmed: submit button reads "Reserve Now", with a "Cancel" button
  // immediately after it. Targeting by accessible name rather than
  // position — an earlier draft used .last() across all buttons, which
  // would have wrongly targeted "Cancel" instead.
  const submitButton = page.getByRole("button", { name: /reserve now/i }).first();

  // Negative case only: empty submit. We deliberately never submit a
  // fully valid booking here — that would create a real booking on the
  // shared public demo instance on every crawl run. Happy-path execution
  // is testRigor's job at actual test-run time, not discovery time.
  if (await submitButton.count()) {
    await submitButton.click().catch(() => {});
    await page.waitForTimeout(500);
    observedValidation.push({
      scenario: "empty submit",
      inputs: {},
      resultText: await captureFeedbackText(page),
    });
  }

  return {
    name: "Booking Creation",
    url: BOOKING_URL,
    fields,
    actions,
    observedValidation,
    notes: [
      'The "Reserve Now" button appears twice in sequence: once to advance from the calendar to ' +
        'the guest-details form, and again to submit that form. Generated test cases must ' +
        'synchronize between the two clicks using testRigor\'s retry-wait pattern, since the ' +
        'calendar view has no "Cancel" button and the guest-details form does — e.g.: ' +
        '`wait 1 sec up to 10 times until page contains "Cancel" below "Reserve Now"`.',
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