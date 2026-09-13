/**
 * crawl.ts — builds the "app inventory" that generate.ts feeds to Claude.
 *
 * Scope (per design doc Section 4): auth flow (admin login) and booking
 * flow (web + API) on the Restful-Booker Platform.
 *
 * TODO (next build step, design doc Section 9 step 4):
 *   1. Playwright: visit automationintesting.online, walk the admin login
 *      page and the booking creation form, record pages/elements/labels.
 *   2. openapi-typescript: parse Restful-Booker's swagger.json into typed
 *      request/response shapes for POST /booking, PUT/DELETE /booking/{id}
 *      (note: PUT/DELETE require an auth token — relevant for negative
 *      cases per Section 4).
 *   3. Write the combined inventory to inventory.json for generate.ts to
 *      consume.
 *
 * Intentionally left as a stub — this is the scaffolding step, not the
 * crawler implementation.
 */

async function main(): Promise<void> {
  throw new Error("crawl.ts not yet implemented — see TODO above");
}

main();
