/**
 * refine.ts — runs after a generate.ts PR merges to main. Reads every
 * test case in test-cases/generated/ (now with full visibility across
 * ALL flows at once, unlike generate.ts's per-flow calls) and:
 *
 * 1. Extracts genuinely repeated step sequences into reusable rules,
 *    written to rules/generated/. Detection is pure deterministic line
 *    matching — no LLM involved in deciding what's a duplicate, since
 *    exact repetition is exact repetition. Claude is used for exactly
 *    one narrow thing: picking a good name for each extracted rule.
 * 2. Replaces hardcoded occurrences of the app's known base URLs with a
 *    suite-level parameter reference, and produces a plain-language
 *    manifest (docs/test-data-needed.md) of what needs to be added to
 *    testRigor's Test Data section before these tests can run — this
 *    project's pipeline has no way to push Test Data entries themselves
 *    (unconfirmed whether the CLI even supports that — see the ⚠️ REVIEW
 *    on TEST_DATA_MANIFEST_PATH below), so that step stays manual.
 *
 * This never touches test-cases/generated/'s *existence* the way
 * generate.ts does (no wipe-and-rewrite) — it edits the files already
 * there in place. It should only ever run after a generate.ts PR has
 * merged, so it's working from approved content, not mid-review content.
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs/promises";
import path from "node:path";
import { CONFIRMED_SYNTAX_NOTES } from "./testrigor-syntax.js";

// ---------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 16000; // naming candidates is a small, bounded task — see generate.ts for why this number
const TEST_CASES_DIR = path.join(process.cwd(), "test-cases", "generated");
const RULES_DIR = path.join(process.cwd(), "rules", "generated");
// ⚠️ REVIEW: this manifest is the workaround for not knowing whether the
// testRigor CLI can push Test Data entries directly (flagged as an open
// question in project discussion, not yet checked against the vendored
// CLI skill docs). If it turns out the CLI does support pushing
// variables, this manifest becomes redundant with an actual push step —
// revisit then rather than building both now on a guess.
const TEST_DATA_MANIFEST_PATH = path.join(process.cwd(), "docs", "test-data-needed.md");

// Known literal base URLs, mirroring crawl.ts's own defaults/env vars.
// Kept as a small fixed table (not general literal-clustering) because
// this project's scope is a fixed, known app surface — a general
// "detect any repeated literal and guess it's a parameter" heuristic
// would be far riskier than targeting the two specific URLs we already
// know matter. ⚠️ REVIEW: extend this table (or replace with something
// more general) if the app surface grows beyond these two.
const KNOWN_BASE_URLS: Array<{ literal: string; paramName: string }> = [
  { literal: process.env.TESTRIGOR_APP_URL ?? "https://automationintesting.online", paramName: "appBaseUrl" },
  { literal: process.env.RESTFUL_BOOKER_API_BASE ?? "https://restful-booker.herokuapp.com", paramName: "apiBaseUrl" },
];

// Minimum contiguous line-sequence length, and minimum number of
// occurrences across (or within) files, before a repeated sequence is
// extracted into a rule. ⚠️ REVIEW: arbitrary starting thresholds —
// tune once we see real output; too low will over-extract trivial
// one-line repeats, too high will miss genuinely useful shared setup.
const MIN_SEQUENCE_LENGTH = 2;
const MIN_OCCURRENCES = 2;

const anthropic = new Anthropic();

// ---------------------------------------------------------------------
// Reading test cases
// ---------------------------------------------------------------------

interface TestCaseFile {
  fileName: string;
  filePath: string;
  header: string; // the leading `// description` line, kept as-is
  steps: string[]; // every line after the header
}

async function readTestCaseFiles(): Promise<TestCaseFile[]> {
  const entries = await fs.readdir(TEST_CASES_DIR, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile() && e.name.endsWith(".txt"));

  const testCases: TestCaseFile[] = [];
  for (const entry of files) {
    const filePath = path.join(TEST_CASES_DIR, entry.name);
    const content = await fs.readFile(filePath, "utf8");
    const lines = content.split("\n").filter((_, i, arr) => i < arr.length - 1 || arr[i] !== "");
    const [header, ...steps] = lines;
    testCases.push({ fileName: entry.name, filePath, header: header ?? "", steps });
  }
  return testCases;
}

// ---------------------------------------------------------------------
// Deterministic repeated-sequence detection
// ---------------------------------------------------------------------

interface SequenceOccurrence {
  fileIndex: number;
  startLine: number; // inclusive index into that file's steps array
  length: number;
}

interface RepeatedSequence {
  lines: string[];
  occurrences: SequenceOccurrence[];
}

/**
 * Finds every contiguous line sequence (length >= MIN_SEQUENCE_LENGTH)
 * that occurs at least MIN_OCCURRENCES times across all files combined,
 * then greedily keeps only the longest non-overlapping matches — so a
 * 4-line repeated block doesn't also get reported as two redundant
 * 2-line sub-blocks. Pure string comparison; no LLM involved.
 */
function findRepeatedSequences(testCases: TestCaseFile[]): RepeatedSequence[] {
  const occurrencesByKey = new Map<string, SequenceOccurrence[]>();
  const maxLength = Math.max(...testCases.map((tc) => tc.steps.length), 0);

  for (let length = MIN_SEQUENCE_LENGTH; length <= maxLength; length++) {
    testCases.forEach((tc, fileIndex) => {
      for (let start = 0; start + length <= tc.steps.length; start++) {
        const slice = tc.steps.slice(start, start + length);
        const key = `${length}::${slice.join("\n")}`;
        const list = occurrencesByKey.get(key) ?? [];
        list.push({ fileIndex, startLine: start, length });
        occurrencesByKey.set(key, list);
      }
    });
  }

  const candidates: RepeatedSequence[] = [];
  for (const [key, occurrences] of occurrencesByKey) {
    if (occurrences.length < MIN_OCCURRENCES) continue;
    const length = Number(key.split("::")[0]);
    const lines = testCases[occurrences[0].fileIndex].steps.slice(
      occurrences[0].startLine,
      occurrences[0].startLine + length
    );
    candidates.push({ lines, occurrences });
  }

  // Longest sequences first, so the greedy claim pass below prefers them.
  candidates.sort((a, b) => b.lines.length - a.lines.length);

  const claimed = new Set<string>(); // `${fileIndex}:${lineIndex}`
  const accepted: RepeatedSequence[] = [];

  for (const candidate of candidates) {
    const unclaimedOccurrences = candidate.occurrences.filter((occ) => {
      for (let i = 0; i < occ.length; i++) {
        if (claimed.has(`${occ.fileIndex}:${occ.startLine + i}`)) return false;
      }
      return true;
    });
    if (unclaimedOccurrences.length < MIN_OCCURRENCES) continue;

    for (const occ of unclaimedOccurrences) {
      for (let i = 0; i < occ.length; i++) {
        claimed.add(`${occ.fileIndex}:${occ.startLine + i}`);
      }
    }
    accepted.push({ lines: candidate.lines, occurrences: unclaimedOccurrences });
  }

  return accepted;
}

// ---------------------------------------------------------------------
// Naming extracted rules (the one narrow use of Claude in this script)
// ---------------------------------------------------------------------

interface NamedRule {
  name: string; // includes the "RR - " prefix
  lines: string[];
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenceMatch ? fenceMatch[1] : trimmed;
}

/**
 * Deterministic fallback name, used if the naming call fails twice.
 * Never blocks the pipeline on what is ultimately a readability
 * nicety — an ugly-but-correct rule beats no rule at all.
 */
function fallbackRuleName(index: number): string {
  return `RR - Shared steps ${index + 1}`;
}

async function nameRules(sequences: RepeatedSequence[]): Promise<NamedRule[]> {
  if (sequences.length === 0) return [];

  const system = [
    "You are naming testRigor reusable rules that have already been mechanically extracted from " +
      "repeated step sequences — the extraction itself is done; your only job is to give each one a " +
      "clear, human-readable name.",
    CONFIRMED_SYNTAX_NOTES,
    'Respond with ONLY a JSON array (no markdown fences, no prose) of exactly one string per input ' +
      'sequence, in the same order, each already including the required "RR - " prefix. Example: ' +
      '["RR - Authenticate as admin via API", "RR - Navigate to admin login"]',
  ].join("\n\n");

  const user = `Sequences to name (each is an array of step lines):\n\n${JSON.stringify(
    sequences.map((s) => s.lines),
    null,
    2
  )}`;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system,
        messages: [{ role: "user", content: user }],
      });
      const raw = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      const names = JSON.parse(stripCodeFence(raw)) as unknown;
      if (!Array.isArray(names) || names.length !== sequences.length || !names.every((n) => typeof n === "string")) {
        throw new Error(`expected an array of ${sequences.length} strings, got: ${raw}`);
      }
      return sequences.map((seq, i) => ({ name: (names as string[])[i], lines: seq.lines }));
    } catch (err) {
      console.error(`nameRules: attempt ${attempt} failed.`, err);
    }
  }

  console.error("nameRules: both attempts failed — falling back to generic names for all extracted rules.");
  return sequences.map((seq, i) => ({ name: fallbackRuleName(i), lines: seq.lines }));
}

// ---------------------------------------------------------------------
// Applying rule extraction back into the test case files
// ---------------------------------------------------------------------

/**
 * Replaces each occurrence's line range with a single bare invocation
 * line, working from the end of each file backward so earlier indices
 * within the same file stay valid as lines are removed.
 */
interface NamedRuleWithOccurrences extends NamedRule {
  occurrences: SequenceOccurrence[];
}

function applyExtraction(testCases: TestCaseFile[], namedRules: NamedRuleWithOccurrences[]): void {
  const byFile = new Map<number, Array<{ startLine: number; length: number; ruleName: string }>>();

  for (const rule of namedRules) {
    for (const occ of rule.occurrences) {
      const list = byFile.get(occ.fileIndex) ?? [];
      list.push({ startLine: occ.startLine, length: occ.length, ruleName: rule.name });
      byFile.set(occ.fileIndex, list);
    }
  }

  for (const [fileIndex, replacements] of byFile) {
    // Descending by startLine so earlier splices don't shift later ones.
    replacements.sort((a, b) => b.startLine - a.startLine);
    const steps = testCases[fileIndex].steps;
    for (const { startLine, length, ruleName } of replacements) {
      steps.splice(startLine, length, ruleName);
    }
  }
}

// ---------------------------------------------------------------------
// Base URL parameterization
// ---------------------------------------------------------------------

interface TestDataNeeded {
  name: string;
  exampleValue: string;
}

/**
 * Replaces literal base-URL occurrences with a stored-value reference,
 * using the URL-specific interpolation phrasing confirmed in the
 * official docs (`from the string with parameters`, not a generic
 * "with parameters" tacked onto "call api"). Returns the set of Test
 * Data entries this introduces, deduplicated.
 */
function parameterizeBaseUrls(testCases: TestCaseFile[]): TestDataNeeded[] {
  const needed = new Map<string, TestDataNeeded>();

  for (const tc of testCases) {
    tc.steps = tc.steps.map((step) => {
      let updated = step;
      for (const { literal, paramName } of KNOWN_BASE_URLS) {
        if (!updated.includes(literal)) continue;
        needed.set(paramName, { name: paramName, exampleValue: literal });

        const withPlaceholder = updated.split(literal).join(`\${${paramName}}`);
        // Only the `call api <method> "<url>"` form needs the
        // method-level "from the string with parameters" modifier;
        // apply it only when this step actually starts with that
        // pattern, to avoid mangling an unrelated step that happens to
        // mention the URL (e.g. inside a check/assertion).
        const callApiMatch = withPlaceholder.match(/^call api (\w+) /);
        if (callApiMatch) {
          updated = withPlaceholder.replace(/^call api (\w+) /, "call api $1 from the string with parameters ");
        } else {
          updated = withPlaceholder;
        }
      }
      return updated;
    });
  }

  return [...needed.values()];
}

async function writeTestDataManifest(entries: TestDataNeeded[]): Promise<void> {
  await fs.mkdir(path.dirname(TEST_DATA_MANIFEST_PATH), { recursive: true });

  if (entries.length === 0) {
    // Still write an (empty-state) file rather than leaving a stale one
    // from a previous run sitting around with outdated entries.
    await fs.writeFile(
      TEST_DATA_MANIFEST_PATH,
      "# Test Data needed\n\nNone — no new suite-level variables were introduced by this refinement pass.\n",
      "utf8"
    );
    return;
  }

  const lines = [
    "# Test Data needed",
    "",
    "This refinement pass parameterized the following values. Before running these test cases, " +
      "add each of these to the suite's **Test Data** section in the testRigor UI:",
    "",
    ...entries.map((e) => `- \`${e.name}\` → \`${e.exampleValue}\``),
    "",
  ];
  await fs.writeFile(TEST_DATA_MANIFEST_PATH, lines.join("\n"), "utf8");
}

// ---------------------------------------------------------------------
// Writing rule files and updated test cases
// ---------------------------------------------------------------------

function slugForFilename(text: string): string {
  return text.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function resetDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}

async function writeRules(namedRules: NamedRuleWithOccurrences[]): Promise<void> {
  await resetDir(RULES_DIR);
  for (const rule of namedRules) {
    const fileName = `${slugForFilename(rule.name)}.txt`;
    await fs.writeFile(path.join(RULES_DIR, fileName), rule.lines.join("\n") + "\n", "utf8");
  }
}

async function writeUpdatedTestCases(testCases: TestCaseFile[]): Promise<void> {
  for (const tc of testCases) {
    const content = [tc.header, ...tc.steps].join("\n") + "\n";
    await fs.writeFile(tc.filePath, content, "utf8");
  }
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------

async function main(): Promise<void> {
  const testCases = await readTestCaseFiles();
  if (testCases.length === 0) {
    console.log(`No test case files found in ${TEST_CASES_DIR} — nothing to refine.`);
    return;
  }

  const sequences = findRepeatedSequences(testCases);
  const named = await nameRules(sequences);
  const namedWithOccurrences: NamedRuleWithOccurrences[] = named.map((rule, i) => ({
    ...rule,
    occurrences: sequences[i].occurrences,
  }));

  applyExtraction(testCases, namedWithOccurrences);
  const testDataNeeded = parameterizeBaseUrls(testCases);

  await writeRules(namedWithOccurrences);
  await writeUpdatedTestCases(testCases);
  await writeTestDataManifest(testDataNeeded);

  console.log(
    `Extracted ${namedWithOccurrences.length} rule(s) to ${RULES_DIR}, parameterized ` +
      `${testDataNeeded.length} base URL(s), and wrote ${TEST_DATA_MANIFEST_PATH}.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
