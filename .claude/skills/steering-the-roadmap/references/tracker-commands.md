# Tracker commands

The commands behind `steering-the-roadmap`. Every command runs from the repository root;
`gh` fills `{owner}` and `{repo}` from the checkout.

## Status: every phase with its work items

```bash
gh api graphql -F owner='{owner}' -F name='{repo}' -f query='
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    issues(first: 50, states: OPEN, labels: ["on hold"],
           orderBy: {field: CREATED_AT, direction: ASC}) {
      nodes {
        number title
        subIssuesSummary { total completed }
        subIssues(first: 50) {
          nodes { number title state labels(first: 10) { nodes { name } } }
        }
      }
    }
  }
}' --jq '.data.repository.issues.nodes[]
  | select(.title | startswith("Phase "))
  | "\(.number) \(.title) [\(.subIssuesSummary.completed)/\(.subIssuesSummary.total)]"
    + (.subIssues.nodes | map("\n   #\(.number) \(.state) \(.title[0:60]) {\(.labels.nodes | map(.name) | join(", "))}") | join(""))'
```

A closed phase parent drops out of this list. To see the landed phases as well, change
`states: OPEN` to `states: [OPEN, CLOSED]`.

## One phase at a glance

```bash
gh issue list --state all --label "phase: 3" --limit 100
```

## Phase labels that disagree with the sub-issue links

Every open sub-issue of a phase parent carries that parent's `phase: N` and no other
phase label. This prints each one that does not; no output means the two agree:

```bash
gh api graphql -F owner='{owner}' -F name='{repo}' -f query='
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    issues(first: 50, states: [OPEN, CLOSED], labels: ["on hold"]) {
      nodes {
        title
        subIssues(first: 50) {
          nodes { number state labels(first: 20) { nodes { name } } }
        }
      }
    }
  }
}' --jq '.data.repository.issues.nodes[]
  | select(.title | startswith("Phase "))
  | (.title | capture("^Phase (?<n>[0-9]+)").n) as $n
  | .subIssues.nodes[]
  | select(.state == "OPEN")
  | (.labels.nodes | map(.name) | map(select(startswith("phase: ")))) as $p
  | select($p != ["phase: \($n)"])
  | "#\(.number) under Phase \($n) carries \($p)"'
```

It checks open work items only: a closed phase is left as it landed, and a parent's own
label is checked by eye in `gh issue list --label "phase: N"`.

## Labelling a work item with its phase

```bash
gh issue edit <n> --add-label "phase: <N>"
# moving it: swap the label with the sub-issue link (removeSubIssue, then addSubIssue)
gh issue edit <n> --remove-label "phase: <old>" --add-label "phase: <new>"
```

## One issue's dependencies

```bash
gh issue view <n> --json body --jq '.body' | grep -E '^Depends on:'
gh issue view <m> --json state --jq '.state'   # for each #m it names
```

A work item is ready when every issue it names is `CLOSED`.

## Linking a work item to its phase

A sub-issue link needs both issues' node ids:

```bash
parent=$(gh api repos/{owner}/{repo}/issues/<phase-parent> --jq .node_id)
child=$(gh api repos/{owner}/{repo}/issues/<work-item> --jq .node_id)
gh api graphql -f query='mutation($p: ID!, $c: ID!) {
  addSubIssue(input: {issueId: $p, subIssueId: $c}) { issue { number } }
}' -f p="$parent" -f c="$child"
```

`removeSubIssue` takes the same input and undoes the link, for example when a work item
moves to another phase.

## Clearing a stale dependency label

```bash
gh issue edit <n> --remove-label "blocked: dependency"
```

Only clear it once every `Depends on:` issue is closed; the label and the line travel
together. **BACKGROUND:** `triaging-issues`.

## Closing a landed phase

```bash
gh issue close <phase-parent> --comment "Exit criteria observed: <the commands and results>."
```

## The improvement lane

```bash
gh issue list --state open --label improvement
```

An `improvement` issue has no phase parent, so the status query above never lists it.
Run this beside it.
