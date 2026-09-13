# testRigor skills

Agent skills for working with [testRigor](https://testrigor.com), the AI-based, plain-English test automation tool. Each subfolder is a self-contained skill — a `SKILL.md` plus any references — written as plain Markdown so **any LLM coding agent** can use it: Claude Code, Codex, Cursor, openclaw, and others.

| Skill | Use it to… |
|-------|------------|
| [`testrigor-dev-loop`](testrigor-dev-loop/SKILL.md) | **Start here.** The end-to-end playbook: build tests + reusable rules as files → run against localhost via the tunnel → debug from the JUnit report → update the remote suite by re-running. |
| [`testrigor-write-tests`](testrigor-write-tests/SKILL.md) | Author test cases in testRigor's plain-English language, the on-disk file formats for test cases / reusable rules / variables, and API steps. Full command catalog in [`reference.md`](testrigor-write-tests/reference.md); API steps in [`api-testing.md`](testrigor-write-tests/api-testing.md). |
| [`testrigor-cli`](testrigor-cli/SKILL.md) | Run/trigger suites with the `testrigor` CLI — auth, the file-mutation (update-remote) model, localhost tunnel, debugging signals, labels, JUnit, mobile builds. |

Typical flow (all orchestrated by `testrigor-dev-loop`): **build** files (`testrigor-write-tests`) → **run on localhost** and **debug** (`testrigor-cli`) → **update remote** by re-running.

## How the skills work

Each skill is a `SKILL.md` whose YAML `description` says when to use it, with heavy detail split into companion files (`reference.md`, `api-testing.md`) that are read only when needed — so the base instructions stay small. How an agent picks them up depends on the agent:

- **Agents that support the Agent Skills format (e.g. Claude Code)** auto-discover the skills and load the relevant one when your request matches its `description` — asking to "write a testRigor checkout test" pulls in `testrigor-write-tests`; "run the suite against localhost" pulls in `testrigor-cli`. You don't have to name a skill, but you can nudge by mentioning the capability.
- **Other agents (Codex, Cursor, …)** use the same Markdown by pointing the agent at this repo, or referencing the `SKILL.md`/`reference.md` files from the agent's own rules/context mechanism (Cursor rules, an `AGENTS.md`, included context, etc.).

## Installing the skills

```bash
git clone https://github.com/TestRigor/skills.git
```

**Claude Code** — copy the folders into its skills directory; they're auto-discovered:

```bash
# personal — available in every project
mkdir -p ~/.claude/skills
cp -r skills/testrigor-* ~/.claude/skills/

# …or project-scoped (only inside one repo):
# cp -r skills/testrigor-* <your-project>/.claude/skills/
```

**Codex / Cursor / other agents** — keep the cloned repo in (or alongside) your project and reference the skill files from your agent's instructions: e.g. point a Cursor rule or an `AGENTS.md` at `testrigor-dev-loop/SKILL.md` as the starting point, or just open the repo so the agent can read the files on demand.

## Prerequisite for running

The `testrigor-cli` skill needs the CLI (Node.js ≥ 18) and a Personal Authentication Token (PAT). Get a PAT in the app: *username (top-right) → API Tokens → Generate New Token*.

```bash
npm install -g @testrigor/testrigor-cli
export TESTRIGOR_API_KEY="<YOUR_PERSONAL_AUTH_TOKEN>"   # non-interactive (best for agents/CI)
```

> `testrigor authenticate` also stores a token, but it prompts interactively — fine for a human to run **once** during local setup, but an agent/CI loop should use the `TESTRIGOR_API_KEY` environment variable (or `--auth-token`) so nothing hangs.

## Prefer an MCP server?

testRigor also ships an **MCP server** — the agent-native alternative to the CLI for running suites and reading results as structured data (no JUnit parsing), with no interactive prompts. Add it to Claude Code with your PAT:

```bash
claude mcp add --transport http testrigor https://api2.testrigor.com/api/v1/mcp \
  --header "personal-access-token: <YOUR_PAT>" -s user
```

Other MCP-capable agents (Cursor, etc.) point their own MCP config at `https://api2.testrigor.com/api/v1/mcp` with the same `personal-access-token` header. The server can list/retrieve suites & cases, run test cases or a green regression, list runs, and read run failures. Guide: https://testrigor.com/how-to-utilise-testrigors-mcp-server/

## Runnable examples

Two complete, runnable sample projects ship **inside the `testrigor-dev-loop` skill** (so they travel with it on install), under [`testrigor-dev-loop/examples/`](testrigor-dev-loop/examples/) and documented in [`testrigor-dev-loop/examples.md`](testrigor-dev-loop/examples.md) — `simple-search` for the basic loop and `shop-checkout` for the localhost tunnel with labels, variables, and negative tests. The `testrigor-write-tests` skill additionally bundles [`examples.md`](testrigor-write-tests/examples.md), a worked authoring mini-project covering every file type. Run the projects to watch the build → run → debug → sync loop end to end.
