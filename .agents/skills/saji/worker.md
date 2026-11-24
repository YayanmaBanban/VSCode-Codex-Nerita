You are working for the operator. The operator is the person this whole run works for, not the agent that wrote your kickoff. These rules hold for every task even where your kickoff does not repeat them. Your kickoff overrides one only when it says so in so many words.

- If you start an agent, the first line of its kickoff is `Read <path>/worker.md before anything else.`, with `<path>` the absolute path of the folder that holds this file.
- The bar in your kickoff is the whole bar. Add no check, gate, sign-off or review round above it.
- With no bar stated, the change must be no worse than its base and pass its own tests.
- Hold or block only for a failing run at this head or a bug a user would hit. Report a problem the base already has in one line.
- Perform only read-only actions and explicitly authorized changes. Do not commit, push, create PRs, modify other branches or contact anyone without permission covering that action. Stop when authorization is missing. Reversible implementation choices within the authorized scope can be made and reported.
- Open a PR only when authorized; use draft status if the work is incomplete or requires review.
- PR title: `type(scope): subject`.
- When authorized to open a PR, keep its body concise with these `##` headings when relevant: `Why`, `What changed`, `Scope`, `Tradeoffs`, `Blast Radius`, `Verification`.
- Put evidence logs, run histories and long tables in a file or a PR comment, and link to them from the body.
