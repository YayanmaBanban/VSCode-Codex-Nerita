---
name: saji
description: pstackベースの開発統括Skill。作業に適したPlaybookを選び、Principleと専門Skillを適用しながら調査・設計・実装・検証を進める。
---

# saji

pstack `poteto-mode`のルーティングをPi/Codexでも使うための移植。原文との対応と変更点は `UPSTREAM.md` を参照する。作業開始時に `references/compatibility.md` を読み、実行環境と利用権限を確認する。

## Non-negotiables

The complete Principles index is in `references/principles.md` and grounds every trigger. In your reply, name each principle that shaped a decision and the specific choice it changed. Cite only principles whose leaf SKILL.md you read this session.

The remaining triggers live only here:

- First message → restate the user's goal and the smallest change that meets it, then proceed. Open each subagent brief, PR `## Why`, and final report with the goal.
- Starting any agent, whether a Task subagent or a Project worker → the first line of its kickoff is `Read <path>/worker.md before anything else.`, with `<path>` the absolute path of the `saji` skill folder. Keep the remainder to the goal, the task and relevant skill path. Agent selection and model availability follow `references/delegation.md`.
- A fork you could settle by running something → prototype it per `playbooks/prototype.md` instead of asking.
- Code → name the data shape first. Across a function boundary → **architect**. Fan-out → **swarm**. Bakeoff → **arena**. Contested design → **interrogate**.
- Prose, your reply included → **unslop**. Docs, PR descriptions, commit messages → **technical-writing**.
- Before commit → `/deslop` from the `cursor-team-kit` plugin. Before review → **no-comments**.
- Shipping UI / IDE / CLI → `control-ui` or `control-cli` from `cursor-team-kit`.
- A number you measured → **benchmark-checklist**.
- PR status → the **Babysit** playbook, not Cursor's built-in babysit skill. Landing a green stack → the **Shipping** playbook.
- Bot review comments → judge each on its merits.
- Long or unattended work → **show-me-your-work**.

- Multi-step work → For multi-step tasks, start the ToDo by checking the complete Principles index. Match the Playbook, copy every numbered step into the ToDo in its original order and detail, and only then add task-specific items. Do not collapse the Playbook into generic phases. This routing requirement comes from the pstack Guide and the upstream Playbooks section.

## Routing

| Scope | Reference |
| --- | --- |
| Choose and execute a Playbook | `references/playbooks.md` → `playbooks/<title>.md` |
| Apply Principles (full trigger index) | `references/principles.md` → `principles/<name>.md` |
| Subagents and worker kickoff | `references/delegation.md`, `worker.md` |
| Autonomy and approval boundaries | `references/autonomy.md` |
| Response style and reporting | `references/communication.md` |
| Tool and host compatibility | `references/compatibility.md` |

The routed document owns its detailed rules. Read it before taking the action. In a conflict involving tools or permissions, the explicit compatibility and authorization rules govern; do not silently omit any Playbook step.
