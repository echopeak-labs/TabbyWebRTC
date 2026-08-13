# Spec orchestration

This file governs every spec under `docs/spec/`. Read it before creating a spec
from a criteria file, splitting domains, or farming implementation to subagents.

Per-spec lock tables and task lists live in `docs/spec/<id>-<slug>/agents.md` and
`docs/spec/<id>-<slug>/tasks.md`. Do not put domain status in this file.

---

## Spec registry

| ID    | Folder                  | Status   | Source                                      |
| ----- | ----------------------- | -------- | ------------------------------------------- |
| `001` | `001-init`              | `review` | Original product criteria (`product/vison`) |
| `002` | `002-win32-support`     | `ready`  | Windows 11 host criteria (`criteria.md`)    |
| `003` | `003-frontend-extended` | `ready`  | Host/Guest first-run UI (`criteria.md`)     |
| `004` | `004-bootstrap`         | `ready`  | Self-host TUI bootstrap (`criteria.md`)     |

When a spec is created or its overall status changes, update this table in the
same change.

---

## Layout

```
docs/spec/
  AGENTS.md                    # this file — creation + orchestration only
  <NNN>-<slug>/
    criteria.md                # unmodified source criteria
    agents.md                  # domain lock table, waves, folder ownership
    tasks.md                   # checkbox tasks, one section per domain spec
    <domain>/
      <NN>-<name>.md           # one domain spec file
```

- IDs are zero-padded three-digit integers. Next ID is max existing + 1.
- Slug is a short kebab-case name derived from the criteria title.
- Domain folders are named after the code area they specify (`frontend`,
  `backend`, `desktop-agent`, `cicd`, `test-server`, …). Only create domains the
  criteria actually requires.
- Number domain files inside each folder (`01-overview.md`, `02-auth.md`).

---

## Status

### Spec-level (registry above)

| Status        | Meaning                                                      |
| ------------- | ------------------------------------------------------------ |
| `draft`       | Folder exists; domain split is incomplete                    |
| `ready`       | Domain specs, `agents.md`, and `tasks.md` are written        |
| `in-progress` | At least one domain spec is being implemented                |
| `review`      | All domain specs implemented; awaiting human review          |
| `done`        | Implemented and verified                                     |
| `blocked`     | Paused; reason belongs in that spec's `agents.md` Notes      |

### Domain-level (`<id>-<slug>/agents.md`)

| Status        | Meaning                                                   |
| ------------- | --------------------------------------------------------- |
| `not-started` | No implementation work has begun                          |
| `in-progress` | An agent is actively implementing this domain spec        |
| `blocked`     | Paused pending a dependency or decision                   |
| `review`      | Implementation complete; awaiting human or agent review   |
| `done`        | Fully implemented and verified                            |

`in-progress` locks a domain spec to one owner. Human review moves `review` →
`done`.

---

## Creating a spec from criteria

The chat that receives "make a full spec out of a criteria.md" (or equivalent) is
the **orchestrator**. It does not implement product code.

1. Read this file.
2. List `docs/spec/<NNN>-*` directories. Next ID is max + 1, zero-padded to 3.
3. Derive `<slug>` from the criteria title.
4. Create `docs/spec/<NNN>-<slug>/`.
5. Write the source criteria to `criteria.md` in that folder. Do not rewrite it
   into a different shape; domain files are the split.
6. Identify domains from the criteria. Split by code ownership, not by
   user-story.
7. Write one spec file per concern under `<domain>/<NN>-<name>.md`. Each file
   must be implementable by one agent with a closed folder boundary.
8. Write `agents.md`: spec header (ID, slug, status `ready`), domain table with
   empty Owner Agent and `not-started`, dependency graph, parallel waves, folder
   ownership (allowed write paths), and the Cursor prompt template pointed at
   this spec's paths.
9. Write `tasks.md`: one `## <domain>/<file>` section per domain spec, ordered
   checkboxes, no work marked done.
10. Add a row to the Spec registry in this file with status `ready`.
11. Stop unless the user also asked to implement.

If the criteria is missing a domain that later work needs, add it as a new
domain spec in the same folder. Do not start a new spec ID for a missing domain
of an existing spec.

---

## Entry point: split domains into subagents

The orchestrator is the single entry point for implementation. It does not
implement a domain spec itself.

1. Open `docs/spec/<NNN>-<slug>/agents.md`. Find the current wave: every
   dependency from prior waves is `review` or `done`.
2. For each domain spec in that wave whose status is `not-started` and whose
   listed dependencies are `review` or `done`, launch **one** subagent.
3. Each subagent gets a single domain spec. Prompt it to:
   - Read `docs/spec/<NNN>-<slug>/agents.md` first
   - Implement only `docs/spec/<NNN>-<slug>/<SPEC_PATH>`
   - Edit only that spec's allowed write paths
   - Work only the matching `## <SPEC_PATH>` section in `tasks.md`
   - Set Owner Agent + `in-progress` before coding
   - On completion: check off tasks, set status `review`, note blockers
4. Do not launch two subagents that share a write path or that
   `agents.md` lists as must-not-run-in-parallel.
5. When the wave's subagents finish, update the spec-level status, then start
   the next wave.
6. Set the registry status to `in-progress` when the first domain starts,
   `review` when every domain spec is `review` or `done`, `done` when a human
   marks the spec complete.

One domain spec → one subagent → one branch → one folder scope.

---

## Subagent prompt template

```text
You are <OWNER_AGENT_ID>.

Read docs/spec/<NNN>-<slug>/agents.md first.
Only implement docs/spec/<NNN>-<slug>/<SPEC_PATH>.
Do not edit files outside the allowed paths for this spec in agents.md.
Do not work on any other spec.

Before coding:
1. Set Owner Agent to <OWNER_AGENT_ID> and Status to in-progress in agents.md.
2. Work only tasks under ## <SPEC_PATH> in docs/spec/<NNN>-<slug>/tasks.md.

Branch: agent/<domain>-<spec>

When done:
1. Mark completed tasks [x] in tasks.md.
2. Set Status to review in agents.md.
3. List any blockers in the Notes column.
```

---

## What this file does not do

- Does not replace `<id>-<slug>/agents.md` as the domain lock table.
- Does not auto-merge branches or detect file conflicts.
- Does not apply to chats that never touch `docs/spec/`. Use `@docs/spec` or a
  spec file in context when asking to create or implement a spec.
