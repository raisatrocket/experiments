# CLAUDE.md

This file provides guidance for AI assistants (Claude Code and others) working in this repository.

## Repository Overview

This is a personal experiments workspace used for testing and prototyping work-related ideas. It is intentionally loosely structured — individual experiments may use different languages, frameworks, and tooling.

**Repository purpose:** Exploratory, one-off experiments. No single production codebase exists here yet.

## Repository Structure

```
experiments/
├── CLAUDE.md        # This file
└── README.md        # Project description
```

As experiments are added, the structure will grow. Each experiment should live in its own directory:

```
experiments/
├── <experiment-name>/
│   ├── README.md    # What this experiment tests and any findings
│   └── ...          # Experiment-specific files
```

## Git Workflow

### Branch naming

Feature branches follow the convention:

```
claude/<description>-<session-id>
```

Example: `claude/claude-md-mlzcftzt6ioguv9m-Rt0zz`

### Commit signing

All commits are signed with SSH. The signing key is at `~/.ssh/commit_signing_key.pub`. Do not skip signing (`--no-gpg-sign` is disallowed).

### Standard workflow

```bash
# Create and switch to a feature branch
git checkout -b claude/<feature>-<id>

# Stage and commit
git add <files>
git commit -m "Short description of change"

# Push with upstream tracking
git push -u origin <branch-name>
```

Always push to the branch you are developing on. Never push directly to `master` without explicit instruction.

## Working with Experiments

### Adding a new experiment

1. Create a directory named after the experiment: `mkdir <experiment-name>`
2. Add a `README.md` describing:
   - The goal or question being explored
   - Setup steps (install dependencies, env vars, etc.)
   - How to run it
   - Findings or results (can be filled in later)
3. Include any language-specific tooling config (e.g., `requirements.txt`, `package.json`) inside the experiment directory, not at the repo root.

### Language and tooling conventions

Because experiments may span languages, follow the most common conventions for each:

| Language   | Package manager | Test runner        | Linter/formatter     |
|------------|-----------------|--------------------|----------------------|
| Python     | `pip` / `uv`    | `pytest`           | `ruff` / `black`     |
| JavaScript | `npm` / `pnpm`  | `vitest` / `jest`  | `eslint` / `prettier`|
| TypeScript | `npm` / `pnpm`  | `vitest` / `jest`  | `eslint` / `prettier`|
| Go         | `go mod`        | `go test`          | `gofmt` / `golangci-lint` |

If an experiment introduces new tooling, document the setup steps in its `README.md`.

## Development Principles

- **Keep experiments self-contained.** Each experiment directory should be independently runnable. Avoid shared code between experiments unless it becomes a deliberate library.
- **Document findings.** Even a short note in `README.md` about what was learned is valuable.
- **Clean up or archive.** Experiments that are finished or abandoned should be marked clearly in their `README.md` rather than silently left in an ambiguous state.
- **Minimal footprint.** Avoid committing large binary files, model weights, or generated artifacts. Add appropriate `.gitignore` entries inside each experiment directory.

## Environment

- **Platform:** Linux
- **Remote:** `http://local_proxy@127.0.0.1:17935/git/raisatrocket/experiments`
- **Git user:** Configured per the local git config; commits are attributed to the committing user.

## Notes for AI Assistants

- This repo has no build system or CI at the repo root level. Check inside each experiment directory for its own build/test instructions.
- When adding files, prefer editing existing files over creating new ones unless a new experiment or component clearly warrants a new file.
- Do not add root-level config files (e.g., `package.json`, `pyproject.toml`) unless they apply to the entire repository. Scope config to the relevant experiment directory.
- Always read existing files before modifying them.
- Follow the branch naming convention above and push to the designated feature branch.
