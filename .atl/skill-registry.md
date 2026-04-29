# Skill Registry — kahoot

Generated: 2026-04-29 | Project: kahoot

## User Skills

| Skill | Trigger |
|-------|---------|
| `branch-pr` | Creating a pull request, opening a PR, or preparing changes for review |
| `go-testing` | Writing Go tests, using teatest, or adding test coverage |
| `issue-creation` | Creating a GitHub issue, reporting a bug, or requesting a feature |
| `judgment-day` | "judgment day", "adversarial review", "dual review", "juzgar" |
| `skill-creator` | Creating new skill, adding agent instructions, documenting patterns for AI |
| `skill-registry` | "update skills", "skill registry", after installing/removing skills |
| `sdd-apply` | Orchestrator launches to implement tasks from a change |
| `sdd-archive` | Orchestrator launches to archive a completed change |
| `sdd-design` | Orchestrator launches to write technical design document |
| `sdd-explore` | Orchestrator launches to investigate/explore a topic |
| `sdd-init` | Initialize SDD context in a project |
| `sdd-onboard` | Guided SDD workflow walkthrough |
| `sdd-propose` | Orchestrator launches to create a change proposal |
| `sdd-spec` | Orchestrator launches to write specifications |
| `sdd-tasks` | Orchestrator launches to break down change into tasks |
| `sdd-verify` | Orchestrator launches to validate implementation against specs |

## Compact Rules

### branch-pr
- ALWAYS create an issue first before opening a PR (issue-first enforcement)
- PR title: under 70 chars, conventional format (feat/fix/chore/etc.)
- PR body: Summary (bullets) + Test plan (checklist) + attribution footer
- Link PR to its issue via "Closes #N" in body
- Never push directly to main; always work on a feature branch

### go-testing
- Table-driven tests only — no single-case test functions
- Use `t.Run(name, func)` for subtests
- For Bubbletea TUI: use `teatest` package, send messages via `tm.Send()`
- Golden files in `testdata/` directory; update with `-update` flag
- Never mock the filesystem — use `os.MkdirTemp` for isolation

### issue-creation
- Every change (feature, bug, refactor) MUST have a GitHub issue first
- Issue title: concise, imperative mood ("Add X", "Fix Y", "Remove Z")
- Bug issues: include steps to reproduce + expected vs actual behavior
- Feature issues: include acceptance criteria as a checklist
- Never start implementation without a linked issue number

### judgment-day
- Launch TWO blind judge sub-agents in parallel simultaneously
- Each judge is independent — do NOT share first judge's findings with second
- After both return: synthesize, apply fixes, then re-judge (max 2 iterations)
- If both pass after fixes: report LGTM. If still failing: escalate to user
- Use for critical code paths, security-sensitive changes, architecture decisions

### skill-creator
- SKILL.md frontmatter: name, description (with Trigger:), license, metadata
- Include "When to Use", "What to Do" (numbered steps), and "Rules" sections
- Compact rules section (5-15 lines) is MANDATORY — used by orchestrator injection
- Save to `~/.claude/skills/{name}/SKILL.md` for user-level skills
- After creating: run `/skill-registry` to update the registry

### sdd-apply
- Read tasks + spec + design before writing any code
- Check for existing apply-progress (engram) — MERGE, never overwrite
- In Strict TDD Mode: write failing test FIRST, then implement
- Mark tasks completed in apply-progress as you go; save after each batch
- Return apply-progress artifact before ending session

### sdd-spec
- Read proposal's Capabilities section first — it dictates which spec files to create
- New domain = full spec; existing domain = delta spec (ADDED/MODIFIED/REMOVED)
- MODIFIED: copy ENTIRE requirement block from main spec, edit it — never partial
- Every requirement MUST have at least one Given/When/Then scenario
- Spec artifact MUST be under 650 words

### sdd-verify
- Compare EVERY spec scenario against actual implementation
- Report: CRITICAL (blocks ship), WARNING (should fix), SUGGESTION (optional)
- Run tests if available — do not claim pass without running them
- Check happy paths AND error/edge cases
- Output verify-report to engram before returning

### sdd-design
- Include sequence diagrams for complex flows (mermaid format)
- Document EVERY architecture decision with rationale (ADR-lite format)
- Identify integration points and external dependencies
- Design MUST reference the proposal's Capabilities section
- Keep design focused: what components, how they interact, why this approach

### sdd-tasks
- Group tasks by phase: infrastructure → implementation → testing
- Hierarchical numbering: 1.1, 1.2, 2.1, etc.
- Each task: completable in one session, atomic, unambiguous
- First task in any phase: always a test/verification step
- Save tasks to engram at `sdd/{change}/tasks` before returning

## Project Conventions

No project-level CLAUDE.md found. Applies global conventions from `~/.claude/CLAUDE.md`.

## Notes

- No project-level skills directory detected
- Tech stack: Node.js + Express + Socket.io (backend), frontend TBD
- No test runner installed yet — Strict TDD Mode cannot be activated until one is added
