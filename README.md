# TestRigor Agentic Companion

Companion project to **"Zero to Hero with TestRigor"**, a 14-part tutorial
series. This repo is a practical AI-tooling exercise with a genuinely usable
result: an agent that scans the Restful-Booker Platform, proposes real
TestRigor test cases with Claude, and — after human review — runs them
against a live TestRigor suite.

Not one of the 14 tutorial parts — linked from Part 14, the capstone.

## What this does

1. Crawls Restful-Booker's web UI (Playwright) and API spec
   (`openapi-typescript`) to build an inventory of the auth and booking
   flows.
2. Claude proposes test cases from that inventory, already written in
   TestRigor's plain-English syntax, grounded in TestRigor's own docs and
   its official skill files (vendored in `vendor/testrigor-skills/`).
3. The proposals land as a GitHub PR for human review — this is the
   real review checkpoint, not a formality.
4. On merge, a GitHub Actions job pushes the reviewed test cases into a
   live TestRigor suite (free plan) and runs them via the official
   `testrigor` CLI.

See [`docs/importing-test-cases.md`](docs/importing-test-cases.md) for how
this relates to test-management tools like Zephyr, Xray, or Qase, and the
full design document (in this repo's history / project docs) for the
complete architecture and the reasoning behind it.

## Setup

1. `npm install`
2. Create two GitHub repo secrets (Settings → Secrets and variables →
   Actions):
   - `ANTHROPIC_API_KEY` — a service account key from your Anthropic
     Console Default Workspace.
   - `TESTRIGOR_API_KEY` — a Personal Access Token from your TestRigor
     account (Settings → API Tokens). Confirmed available on the free
     "open source" plan.
3. Run the **Agentic test-case pipeline** workflow manually (Actions tab →
   "Run workflow") to trigger a crawl + generation pass. Review the PR it
   opens. Merging it triggers the push-and-run job automatically.

## Status

Scaffolding stage — folder structure, tooling, and CI wiring are in place;
`src/crawl.ts`, `src/generate.ts`, and `src/push-and-run.ts` are stubs with
TODOs describing what they'll do. See the design doc for the build order.
