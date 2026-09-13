# Importing test cases into TestRigor

_Status: stub — to be filled in once the narrow Zephyr showcase (design doc
Section 5) is captured._

This page will cover:

- TestRigor's general, tool-agnostic pattern for bringing in manually
  written test cases from an external system (Zephyr, Xray, Qase, or
  anywhere else) via "Add Custom Test Case".
- How those steps should be written, grounded in TestRigor's official
  Language Documentation, the Certification course material, and the
  "golden rules" from the vendored official skill files (one action per
  line, quote everything the user reads, assert often, prefer built-in
  reusable rules, use variables instead of hard-coded values, don't
  hard-code the app URL).
- A worked example: two test cases (auth login happy path, booking-creation
  happy path) written as Zephyr tickets, imported into TestRigor via
  Settings → Integrations → Zephyr, with screenshots of each step.
