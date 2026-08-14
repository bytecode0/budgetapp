---
name: ship
description: Run a scoped coding task through implementer → verify → reviewer, looping up to 3 rounds until the reviewer finds nothing, then report a summary. Use when the user wants a task implemented without babysitting each step (e.g. "/ship add X", "ship this: ...").
---

The user invoking this skill is explicit authorization to delegate to the `implementer` and `reviewer` subagents defined in `.claude/agents/` — do not ask for confirmation before spawning them.

Task description: `$ARGUMENTS`

Follow this loop, up to 3 rounds:

1. **Implement.** Call the `implementer` agent (via the Agent tool, `subagent_type: "implementer"`) with the task description. On round 2+, include the reviewer's findings from the previous round as the task, framed as fixes to make — not a restatement of the original task. The `implementer` agent's own instructions require it to run `npm run verify` before returning; trust that but don't skip the review.
2. **Review.** Once the implementer returns, get the diff (`git diff` in Bash) and call the `reviewer` agent (`subagent_type: "reviewer"`) with that diff plus a one-line description of what the task was. The `reviewer` reports via `ReportFindings`.
3. **Decide.**
   - If `reviewer` returns no findings (or only `PLAUSIBLE`/low-severity ones you judge not worth another round) → done. Go to step 4.
   - If it returns real findings and you're under 3 rounds → go back to step 1 with those findings as the next task.
   - If it returns real findings and you've hit 3 rounds → stop looping. Go to step 4 and report the unresolved findings instead of hiding them.

4. **Report to the user.** A short summary: what was built (files touched), how many rounds it took, the final `npm run verify` status, and — if you stopped at the round cap with findings still open — list them explicitly so the user can decide whether to accept, fix manually, or run `/ship` again with a narrower task.

Do not ask the user for approval between rounds. Do not silently drop findings that survived to the round cap.
