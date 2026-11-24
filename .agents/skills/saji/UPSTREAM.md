# Upstream source and adaptations

This directory is a pstack-derived, modified distribution.

- Upstream: https://github.com/cursor/plugins/tree/005d8f6e8ec057b738adcd08a08b30db0478402d/pstack
- Source commit: `005d8f6e8ec057b738adcd08a08b30db0478402d` (pinned; not a moving `main` reference)
- Original license: MIT, Copyright (c) 2026 Lauren Tan. See `LICENSE.pstack`.
- Source originals: `skills/poteto-mode/SKILL.md`, `skills/poteto-mode/worker.md`, all 22 `skills/poteto-mode/playbooks/*.md`, and 24 `skills/principle-*/SKILL.md`.

## Explicit adaptations

1. Renamed the entry skill `poteto-mode` → `saji` and retained the upstream Non-negotiables triggers in the entry, with the Principles, Autonomy, Subagents, Writing the reply, and Playbooks sections routed to separate references.
2. Added the multi-step Principles-first ToDo and full Playbook-step expansion specified by the upstream Guide. The heading and nested checkpoint content must not be shortened.
3. Replaced Cursor `poteto-agent`, model slugs, `Task` arguments and setup-file assumptions with host capabilities in `references/delegation.md` and `references/compatibility.md`. No roles JSON.
4. Tightened autonomy and `worker.md`: repository commits, pushes and PR actions require user authorization. This explicitly overrides upstream instructions to commit or ship autonomously.
5. Copied all 22 original Playbooks, retaining their stages and substeps. Fixed model slugs are normalized to `<role-model>` and interpreted only through `references/delegation.md`.
6. Copied the full body of all 24 Principle leaf Skills to `principles/*.md`, excluding Cursor-specific Skill frontmatter. Their triggers remain in `references/principles.md`.
7. Specialist Task Skills (`architect`, `swarm`, `arena`, `how`, `interrogate` and others), external Cursor Team Kit Skills and their implementation are **not bundled here**. Until installed or adapted, relevant Playbook steps remain explicit dependencies rather than simulated successes.

No pstack-derived documentation should be mistaken for a product build or passing runtime tests.
