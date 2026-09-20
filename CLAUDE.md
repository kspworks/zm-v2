@AGENTS.md

# Commits and PRs

Never add AI attribution to commits or pull requests: no `Co-Authored-By: Claude …` trailer, no "Generated with Claude Code" line, and no similar mention.

After finishing the work of an executed plan, end the reply with a proposed
commit message in a fenced block: a Conventional Commit subject with scope
(`feat(dashboard):`, `fix(categories):`, `docs:` …), a blank line, then one or
two short paragraphs wrapped at ~72 characters saying why the change was made.
It is a proposal — don't run `git commit` unless asked.
