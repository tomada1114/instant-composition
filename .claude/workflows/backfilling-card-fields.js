export const meta = {
  name: "backfilling-card-fields",
  description:
    "Fill one newly declared optional card field across existing cards in batches, commit, then review the field on a cards/* branch",
  whenToUse: "Run by the backfilling-card-fields skill",
  phases: [
    { title: "Prepare", detail: "preconditions, branch, queue" },
    { title: "Fill", detail: "one filler per 20 cards, in parallel" },
    { title: "Apply", detail: "one pnpm cards:update at a time" },
    { title: "Commit" },
    { title: "Review", detail: "the reviewing-cards workflow, --field" },
  ],
};

// Every card job runs on Sonnet 5.5 at medium effort (see reviewing-cards.js).
const SONNET = { model: "sonnet", effort: "medium" };
const BRANCH = ".claude/skills/reviewing-cards/references/branch.md";

const a = args ?? {};
const field = a.field;
if (!field || !/^[a-zA-Z][\w-]*$/.test(field)) return { stop: "pass the field name" };
const spec = `.claude/skills/backfilling-card-fields/references/fields/${field}.md`;

// pnpm cards:* write commands take a lock on content/ and fail fast with
// ERR_CARDS_BUSY; they run strictly one at a time through this chain.
let tail = Promise.resolve();
function serial(fn) {
  const run = tail.then(fn);
  tail = run.catch(() => undefined);
  return run;
}

const STOP = {
  stop: {
    type: "string",
    description: "set only when a precondition or stop rule fired",
  },
};

phase("Prepare");
const range = [a.topic && `topic=${a.topic}`, a.level && `level=${a.level}`]
  .filter(Boolean)
  .join(" ");
const prep = await agent(
  `Prepare a backfill of the card field \`${field}\` in this checkout. Change nothing until both preconditions hold; if either fails, set "stop" naming which:
1. \`${field}\` is declared, with its value check, in OPTIONAL_FIELDS in scripts/cards/schema.mjs.
2. \`${spec}\` exists with the four sections **What it holds**, **Length**, **Examples** (at least three, good and bad) and **Review**.
Then read \`${BRANCH}\` and run its branch step. Then \`pnpm -s cards:queue --missing ${field} ${range} --limit ${a.limit ?? 200} --json\` and return each entry's card as "cards".
Any ERR_* failure, or a branch stop: set "stop".`,
  {
    ...SONNET,
    label: "prepare",
    phase: "Prepare",
    schema: {
      type: "object",
      properties: {
        branch: { type: "string" },
        cards: { type: "array", items: { type: "object" } },
        ...STOP,
      },
      required: ["branch", "cards"],
    },
  },
);
if (!prep) return { stop: "the prepare agent did not return" };
if (prep.stop) return { stop: prep.stop };
log(`${prep.cards.length} cards miss \`${field}\` on ${prep.branch}`);
if (!prep.cards.length) return { branch: prep.branch, filled: 0 };

const batches = [];
for (let i = 0; i < prep.cards.length; i += 20)
  batches.push(prep.cards.slice(i, i + 20));

let stopped = null;
const results = await pipeline(
  batches,
  (cards, _b, i) =>
    agent(
      `Fill the card field \`${field}\` for every card below. Read \`${spec}\` and \`content/guides/writing.md\` and follow the spec exactly. Write \`[{ "id": …, "${field}": … }]\` as JSON to \`tmp/cards/${field}-${i + 1}.json\` and check it parses. Run no pnpm cards:* write command.

Cards:
${JSON.stringify(cards, null, 1)}`,
      { ...SONNET, label: `fill batch ${i + 1}`, phase: "Fill" },
    ),
  (wrote, cards, i) =>
    wrote === null
      ? { batch: i + 1, skipped: "the filler did not return" }
      : serial(() =>
          stopped
            ? { batch: i + 1, skipped: stopped }
            : agent(
                `Run \`pnpm -s cards:update tmp/cards/${field}-${i + 1}.json --json\` in this checkout and report the ids it updated and the entries it rejected with their reasons. Do not retry a rejected entry by hand. A missing or unparseable file updates nothing: report that in "skipped". On ERR_CARDS_BUSY wait a few seconds and rerun. Any other ERR_* failure: set "stop".`,
                {
                  ...SONNET,
                  label: `apply batch ${i + 1}`,
                  phase: "Apply",
                  schema: {
                    type: "object",
                    properties: {
                      updated: { type: "array", items: { type: "string" } },
                      rejected: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            id: { type: "string" },
                            reason: { type: "string" },
                          },
                        },
                      },
                      skipped: { type: "string" },
                      ...STOP,
                    },
                    required: ["updated", "rejected"],
                  },
                },
              ).then((r) => {
                if (r?.stop) stopped = r.stop;
                return r
                  ? { batch: i + 1, ...r }
                  : { batch: i + 1, skipped: "the applier did not return" };
              }),
        ),
);

const done = results.filter(Boolean);
const updated = done.flatMap((r) => r.updated ?? []);

phase("Commit");
let commit = "";
if (updated.length) {
  const c = await agent(
    `In this checkout: \`git add content\`; if \`git diff --cached --quiet\` reports nothing staged, skip the commit. Otherwise \`git commit -m "feat(cards): backfill ${field} on ${updated.length} cards"\`. Never --no-verify. If the pre-commit hook fails, report it in "stop".`,
    {
      ...SONNET,
      label: "commit",
      phase: "Commit",
      schema: {
        type: "object",
        properties: {
          commit: {
            type: "string",
            description: "the short commit hash only, or empty when nothing was staged",
          },
          ...STOP,
        },
        required: ["commit"],
      },
    },
  );
  if (c?.stop) stopped = c.stop;
  commit = c?.commit ?? "";
}

let review = null;
if (updated.length && !stopped) {
  phase("Review");
  try {
    review = await workflow(
      { scriptPath: ".claude/workflows/reviewing-cards.js" },
      { field, limit: updated.length },
    );
  } catch (error) {
    review = { stop: `the review workflow failed to start: ${String(error)}` };
  }
}

const left = await agent(
  `Run \`pnpm -s cards:queue --missing ${field} --count\` and return the number it prints.`,
  {
    ...SONNET,
    label: "remaining",
    phase: "Review",
    schema: {
      type: "object",
      properties: { count: { type: "integer" } },
      required: ["count"],
    },
  },
);

return {
  branch: prep.branch,
  field,
  filled: updated.length,
  rejected: done.flatMap((r) => r.rejected ?? []),
  batchesSkipped: done
    .filter((r) => r.skipped)
    .map((r) => ({ batch: r.batch, why: r.skipped })),
  commit,
  review,
  stop: stopped,
  stillMissing: left?.count,
};
