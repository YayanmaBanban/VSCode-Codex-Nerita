# Subagents

**Parent ownership.** The chat receiving `saji` executes the Playbook itself, owns the ToDo and reviews every delegate. A delegated worker must read `worker.md` before working.

**Named-agent routing.** When a fixed-name agent defined by the current host matches the task, use it. Otherwise use another available agent with the same task scope; if no agent interface exists, the parent handles the step and retains independent review where the Playbook requires it. Never invent an agent, tool argument or model slug.

**Model selection.** Use the host-supported model configuration or inherit the parent model. Do not embed a particular provider, model version, reasoning level or background-execution flag. Use multiple vendors for a second opinion only where available. Missing models are not an excuse to skip required evidence.

**Worker kickoff.** The first line is `Read <path>/worker.md before anything else.` where `<path>` is this skill folder's absolute path. Give the goal, scope, files/data shape, verification criteria, and relative source pointers. Do not embed huge file contents when the worker can read the files.

You own every subagent's work. Review the diff and write your own summary. A second opinion is the same prompt on another vendor's model.

**Fresh subagents by default.** Give a fix round, a follow-up, a retry, or the next queue item to a fresh subagent with the original brief, every later directive, and the prior agent's report and branch. Resume an existing subagent only when the work needs state that lives in it and is costly to move: its checkout, its uncommitted changes, or a process it still runs.
