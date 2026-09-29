# Branch step

Every card workflow runs this first, before it changes anything.

1. `git status --porcelain`. If anything outside `content/` and `tmp/` is modified or
   untracked, stop and report the paths.
2. `git branch --show-current`:
   - `main`: create `cards/<YYYY-MM-DD>` from today's local date (`date +%F`), appending
     `-2`, `-3` … if that branch already exists, and switch to it.
   - a `cards/*` branch: stay on it.
   - anything else: stop and report the branch — a card workflow never commits anywhere
     but a `cards/*` branch.
3. `mkdir -p tmp/cards` (`tmp/` is gitignored scratch).

Return the branch name you ended on.
