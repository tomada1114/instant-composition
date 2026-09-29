export const meta = {
  name: "generating-cards",
  description:
    "Plan thin cells, write instant-composition cards one writer per cell, admit them, commit, then review them on a cards/* branch",
  whenToUse: "Run by the generating-cards skill",
  phases: [
    { title: "Prepare", detail: "branch, new subtopic, plan" },
    { title: "Write", detail: "one writer per cell, in parallel" },
    { title: "Admit", detail: "one pnpm cards:add at a time, one top-up" },
    { title: "Commit" },
    { title: "Review", detail: "the reviewing-cards workflow" },
  ],
};

// Every card job runs on Sonnet 5.5 at medium effort (see reviewing-cards.js).
const SONNET = { model: "sonnet", effort: "medium" };
const WRITER_BRIEF = ".claude/skills/generating-cards/references/writer-brief.md";
const BRANCH = ".claude/skills/reviewing-cards/references/branch.md";

const a = args ?? {};
const count = Math.min(Number(a.count) || 0, 50);
if (count < 1) return { stop: "count must be between 1 and 50" };
if (a.isNew && !a.subtopic) return { stop: "`new` needs subtopic=<topic>/<id>" };

// pnpm cards:* write commands take a lock on content/ and fail fast with
// ERR_CARDS_BUSY; they run strictly one at a time through this chain.
let tail = Promise.resolve();
function serial(fn) {
  const run = tail.then(fn);
  tail = run.catch(() => undefined);
  return run;
}

const STOP = {
  stop: { type: "string", description: "set only when a stop rule fired" },
};

phase("Prepare");
const range = [
  a.topic && `topic=${a.topic}`,
  a.subtopic && `subtopic=${a.subtopic}`,
  a.level && `level=${a.level}`,
]
  .filter(Boolean)
  .join(" ");
const prep = await agent(
  `Prepare a card generation run in this checkout. Read \`${BRANCH}\` and run its branch step first.
${
  a.isNew
    ? `Then add the subtopic \`${a.subtopic}\` to content/taxonomy.json under its topic as { id, ja, scene } — ja a short Japanese name, scene one or two Japanese sentences saying where its sentences happen, in the style of its neighbours — and run \`pnpm -s cards:lint\` to confirm the taxonomy still parses.`
    : "Do not edit content/taxonomy.json: an unknown subtopic is a stop, not an invitation to add one."
}
Then run \`pnpm -s cards:gaps ${count} ${range} --json\` and return its plan, planned and shortfall unchanged.
Any ERR_* failure, or a branch stop: set "stop" and do nothing further.`,
  {
    ...SONNET,
    label: "prepare",
    phase: "Prepare",
    schema: {
      type: "object",
      properties: {
        branch: { type: "string" },
        plan: {
          type: "array",
          items: {
            type: "object",
            properties: {
              topic: { type: "string" },
              subtopic: { type: "string" },
              level: { type: "integer" },
              count: { type: "integer" },
              targetGrammar: { type: "array", items: { type: "string" } },
            },
            required: ["topic", "subtopic", "level", "count", "targetGrammar"],
          },
        },
        planned: { type: "integer" },
        shortfall: { type: "integer" },
        ...STOP,
      },
      required: ["branch", "plan"],
    },
  },
);
if (!prep) return { stop: "the prepare agent did not return" };
if (prep.stop) return { stop: prep.stop };
log(
  `${prep.planned ?? count} cards planned over ${prep.plan.length} cells on ${prep.branch}`,
);

const ADMITTED = {
  type: "object",
  properties: {
    admitted: { type: "array", items: { type: "string" } },
    dropped: {
      type: "array",
      items: {
        type: "object",
        properties: { ja: { type: "string" }, reason: { type: "string" } },
        required: ["reason"],
      },
    },
    ...STOP,
  },
  required: ["admitted", "dropped"],
};

function writerPrompt(cell, n, file, dropped) {
  const retry = dropped
    ? `\nThis is a top-up: an earlier batch for this cell lost cards at admission. Write ${n} different cards and avoid what made these fail:\n${JSON.stringify(dropped, null, 1)}\n`
    : "";
  return `Write ${n} new instant-composition card(s). Read \`${WRITER_BRIEF}\` and follow it for cell ${cell.topic}/${cell.subtopic}, level ${cell.level}, target grammar ${JSON.stringify(cell.targetGrammar)}. Write the JSON array to \`${file}\`. Run no pnpm cards:* write command.${retry}`;
}

function admitPrompt(file) {
  return `Run \`pnpm -s cards:add ${file} --json\` in this checkout and report which ids it admitted and which cards it dropped with the reason (a lint rule, or NEAR_DUPLICATE with what it resembles). Do not edit the file and do not re-add a dropped card. A missing or unparseable file admits nothing: report it as one drop with that reason. On ERR_CARDS_BUSY, wait a few seconds and rerun. Any other ERR_* failure: set "stop".`;
}

let stopped = null;
async function admit(file, label) {
  const r = await serial(() =>
    stopped
      ? null
      : agent(admitPrompt(file), {
          ...SONNET,
          label,
          phase: "Admit",
          schema: ADMITTED,
        }),
  );
  if (r?.stop) stopped = r.stop;
  return r;
}

const cells = await pipeline(prep.plan, async (cell) => {
  const name = `${cell.topic}-${cell.subtopic}-${cell.level}`;
  const file = `tmp/cards/${name}.json`;
  const wrote = await agent(writerPrompt(cell, cell.count, file), {
    ...SONNET,
    label: `write ${name}`,
    phase: "Write",
  });
  if (wrote === null)
    return {
      cell: name,
      planned: cell.count,
      admitted: [],
      dropped: [],
      writerFailed: true,
    };
  const first = await admit(file, `admit ${name}`);
  if (!first)
    return {
      cell: name,
      planned: cell.count,
      admitted: [],
      dropped: [],
      writerFailed: true,
    };
  const admitted = [...first.admitted];
  const dropped = [...first.dropped];

  // One top-up for the missing count only; never a second.
  const missing = cell.count - admitted.length;
  if (missing > 0 && !stopped) {
    const topFile = `tmp/cards/${name}-topup.json`;
    const again = await agent(writerPrompt(cell, missing, topFile, first.dropped), {
      ...SONNET,
      label: `top up ${name}`,
      phase: "Write",
    });
    if (again !== null) {
      const second = await admit(topFile, `admit top-up ${name}`);
      if (second) {
        admitted.push(...second.admitted);
        dropped.push(...second.dropped);
      }
    }
  }
  return { cell: name, planned: cell.count, admitted, dropped };
});

const results = cells.filter(Boolean);
const ids = results.flatMap((c) => c.admitted);
const shortCells = results
  .filter((c) => c.admitted.length < c.planned)
  .map((c) => ({ cell: c.cell, short: c.planned - c.admitted.length }));
if (shortCells.length)
  log(
    `short after one top-up: ${shortCells.map((s) => `${s.cell} −${s.short}`).join(", ")}`,
  );

phase("Commit");
let commit = "";
if (ids.length) {
  const done = await agent(
    `In this checkout: \`git add content\`; if \`git diff --cached --quiet\` reports nothing staged, skip the commit. Otherwise \`git commit -m "feat(cards): add ${ids.length} cards (${results
      .filter((c) => c.admitted.length)
      .map((c) => c.cell)
      .join(
        ", ",
      )})"\`. Never --no-verify. If the pre-commit hook fails on content/ this run wrote, report it in "stop"; do not work around it.`,
    {
      ...SONNET,
      label: "commit",
      phase: "Commit",
      schema: {
        type: "object",
        properties: { commit: { type: "string" }, ...STOP },
        required: ["commit"],
      },
    },
  );
  if (done?.stop) stopped = done.stop;
  commit = done?.commit ?? "";
}

let review = null;
if (ids.length && !a.noReview && !stopped) {
  phase("Review");
  try {
    review = await workflow(
      { scriptPath: ".claude/workflows/reviewing-cards.js" },
      { ids },
    );
  } catch (error) {
    review = { stop: `the review workflow failed to start: ${String(error)}` };
  }
}

const stats = await agent(
  "Run `pnpm -s cards:stats --short` and return its output verbatim.",
  {
    ...SONNET,
    label: "stats",
    phase: "Review",
  },
);

const dropReasons = {};
for (const d of results.flatMap((c) => c.dropped)) {
  const key = d.reason.split(/[:\s]/)[0];
  dropReasons[key] = (dropReasons[key] ?? 0) + 1;
}
return {
  branch: prep.branch,
  requested: count,
  planned: prep.planned,
  gapsShortfall: prep.shortfall ?? 0,
  admittedPerCell: results.map((c) => ({
    cell: c.cell,
    admitted: c.admitted.length,
    planned: c.planned,
  })),
  dropReasons,
  writerFailedCells: results.filter((c) => c.writerFailed).map((c) => c.cell),
  topUpShortfall: shortCells,
  commit,
  review: a.noReview ? "skipped (--no-review): the cards stay unstamped" : review,
  stop: stopped,
  stats,
};
