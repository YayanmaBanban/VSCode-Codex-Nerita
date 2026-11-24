# Environment compatibility — Pi / Codex

These rules translate Cursor-specific instructions from the pinned pstack source; they do not delete Playbook phases or alter their intended checks.

## Resolution order

1. Explicit user approval and current repository policies determine what may be written.
2. `references/autonomy.md` and `worker.md` set the permission boundary. In particular, “commit liberally”, “Opening a PR” or “Shipping” in upstream Playbooks does **not** grant permission to commit, push or merge.
3. Follow every selected Playbook step in order. Map only execution details that the current host does not support. Do not claim unavailable tools, agents or checks ran.
4. Keep notes of concrete substitutions and blocked steps in the task report; do not introduce new blanket rules into the original Playbook.

## Host mappings

| Upstream mechanism | Pi / Codex handling |
| --- | --- |
| Cursor `Task`, `subagent_type`, Project workers | Use an available fixed-name agent for the role when defined; otherwise an available delegate, or the parent with the Playbook's required review separation |
| Fixed Opus / Gemini / Fable model slug and `-fast` / `xhigh` | Ignore fixed model identifiers; choose host-supported configuration, otherwise inherit parent; do not create a roles JSON |
| `run_in_background`, `readonly`, `environment: cloud`, `resume` | Map to available host capabilities. Never pass an unsupported field; if isolation is needed, use a real worktree or mark the restriction |
| Cursor ToDo tool | Use the host's task list. If unavailable, maintain a visible Markdown ToDo with the complete Playbook steps and progress |
| Built-in Cursor `create-skill`, Cursor Team Kit `/deslop`, `control-ui`, `control-cli` | Use the actual installed equivalent only when it exists; otherwise mark the step unavailable and preserve the verification requirement |
| Named specialist Skills (`how`, `architect`, `arena`, `swarm`, `interrogate`, etc.) | Read their installed `SKILL.md` if available. If not installed, disclose the missing dependency; do not fabricate invocation or claim it completed |
| Git, PR, automations, Bugbot, external services | Only run supported operations within explicit user authorization. Absent or Cursor-only operations must be reported as unavailable |

A mandatory correctness or UI verification step cannot be treated as passed because the original tool is missing. Verify on the same observable surface with a supported equivalent or report the feature as unverified.

## Source integrity

All `playbooks/*.md` keep the upstream stages, headings and substeps. Source-specific model slugs may be replaced with `<role-model>`; this is a model-selection adapter, not permission to omit a phase. The original source is pinned in `UPSTREAM.md`.
