@AGENTS.md

# Commits and PRs

Never add AI attribution to commits or pull requests: no `Co-Authored-By: Claude …` trailer, no "Generated with Claude Code" line, and no similar mention.

After finishing the work of an executed plan, end the reply with a proposed
commit message in a fenced block: a Conventional Commit subject with scope
(`feat(dashboard):`, `fix(categories):`, `docs:` …), a blank line, then one or
two short paragraphs wrapped at ~72 characters saying why the change was made.
It is a proposal — don't run `git commit` unless asked.

After finishing the work of an executed plan, also hand over the session's
changes as a patch against `main`, printed in the reply so it can be copied in
one click. Run `git add -N` on any new untracked files so they are included,
then paste the output of `git diff $(git merge-base main HEAD)` — committed
and uncommitted work, but not later commits on `main` — verbatim in a fenced
`diff` block, placed just before the commit message. Make the fence longer
than any backtick run inside the diff (e.g. ```` when it touches Markdown) so
it isn't cut short. Don't write a `.patch` file or send an attachment. Skip it
when no files changed.
