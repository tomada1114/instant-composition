export const meta = {
  name: "reviewing-cards",
  description:
    "Review queued instant-composition cards with blind, naturalness and tag reviewers, apply the verdicts, stamp and commit on a cards/* branch",
  whenToUse:
    "Run by the reviewing-cards skill, or as a child of generating-cards and backfilling-card-fields",
  phases: [
    { title: "Prepare", detail: "branch, lint, queue" },
    { title: "Review", detail: "R1, R2 and R3 per batch, in parallel" },
    { title: "Adjudicate", detail: "keep, edit, rebuild or delete" },
    { title: "Apply", detail: "one pnpm cards:* write at a time" },
    { title: "Second round", detail: "re-review edited and rebuilt cards" },
    { title: "Report", detail: "queue count" },
  ],
};

// Every card job runs on Sonnet 5.5 at medium effort; quality rests on the
// pipeline (lint, near-duplicate check, three blind reviewers, a second round
// that deletes), not on a bigger model.
const SONNET = { model: "sonnet", effort: "medium" };
const SKILL = ".claude/skills/reviewing-cards";
const WRITER_BRIEF = ".claude/skills/generating-cards/references/writer-brief.md";
const BATCH_SIZE = 15;

const a = args ?? {};
const note = a.note
  ? `\nThe owner noticed this while using the app: ${a.note}. Check it specifically.\n`
  : "";

// `pnpm cards:*` write commands each take a lock on content/ and fail fast
// with ERR_CARDS_BUSY when another holds it, and every commit shares one
// index: both run strictly one at a time through this chain.
let tail = Promise.resolve();
function serial(fn) {
  const run = tail.then(fn);
  tail = run.catch(() => undefined);
  return run;
}

const FINDING = {
  type: "object",
  properties: {
    id: { type: "string" },
    reviewer: { type: "string" },
    check: { type: "string" },
    verdict: { enum: ["FIX", "REBUILD", "DROP"] },
    confidence: { enum: ["high", "medium", "low"] },
    problem: { type: "string" },
    suggestion: { type: "string" },
  },
  required: ["id", "check", "verdict", "confidence", "problem"],
};
const FINDINGS = {
  type: "object",
  properties: { findings: { type: "array", items: FINDING } },
  required: ["findings"],
};
const BLIND = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          sentences: { type: "array", items: { type: "string" } },
        },
        required: ["label", "sentences"],
      },
    },
  },
  required: ["results"],
};
const STOP = {
  stop: { type: "string", description: "set only when a stop rule fired" },
};

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function levelInfo(levels, n) {
  const l = levels.find((x) => x.level === n);
  return l
    ? `level ${n} — ${l.summary}; ${l.wordsMin}–${l.wordsMax} words`
    : `level ${n}`;
}

function r1Prompt(cards, levels) {
  const lines = cards.map(
    (c, i) => `- b${i + 1} (${levelInfo(levels, c.level)}): ${c.ja}`,
  );
  return `You are a fluent English speaker helping build a Japanese→English speaking drill. For each Japanese sentence below, write 1–3 English sentences a fluent speaker would naturally say in that situation, at the given level, most likely first, each within the level's word range and as short as the situation allows. Work only from what is in this message: do not open, search or read any file in the repository or anywhere else, and run no command. Do not explain. Return one result per sentence, every label included.

${lines.join("\n")}`;
}

function r2Prompt(cards) {
  const view = cards.map(({ id, ja, en, alternatives, level }) => ({
    id,
    ja,
    en,
    alternatives,
    level,
  }));
  return `You are reviewer R2 for a Japanese→English speaking drill. Read \`${SKILL}/references/reviewer-briefs.md\` (section "R2") and follow it; it names the files to read. Do not read any other card, and write nothing.
${note}
Cards:
${JSON.stringify(view, null, 1)}

Return only the failing cards as findings (reviewer "R2"); an empty list when every card passes.`;
}

function r3Prompt(cards) {
  const ids = cards.map((c) => c.id).join(",");
  const cells = [...new Set(cards.map((c) => `${c.topic}/${c.subtopic}`))];
  return `You are reviewer R3 for a Japanese→English speaking drill. Read \`${SKILL}/references/reviewer-briefs.md\` (section "R3") and follow it. Run \`pnpm -s cards:dupes --ids ${ids} --json\` and, for each of ${cells.join(", ")}, \`pnpm -s cards:show --cell <cell> --brief\`. Read-only commands only; write nothing.
${note}
Cards:
${JSON.stringify(cards, null, 1)}

Return only the failing cards as findings (reviewer "R3"); an empty list when every card passes.`;
}

async function review(cards, levels, withR3, tag) {
  const labelled = cards.map((c, i) => ({ label: `b${i + 1}`, id: c.id }));
  const [r1, r2, r3] = await parallel([
    () =>
      agent(r1Prompt(cards, levels), {
        ...SONNET,
        label: `R1 ${tag}`,
        phase: "Review",
        schema: BLIND,
      }),
    () =>
      agent(r2Prompt(cards), {
        ...SONNET,
        label: `R2 ${tag}`,
        phase: "Review",
        schema: FINDINGS,
      }),
    () =>
      withR3
        ? agent(r3Prompt(cards), {
            ...SONNET,
            label: `R3 ${tag}`,
            phase: "Review",
            schema: FINDINGS,
          })
        : Promise.resolve({ findings: [] }),
  ]);
  if (!r1 || !r2 || !r3) return null;
  const blind = r1.results.map((r) => ({
    id: labelled.find((l) => l.label === r.label)?.id ?? r.label,
    sentences: r.sentences,
  }));
  return { blind, findings: [...r2.findings, ...r3.findings] };
}

const DECISIONS = {
  type: "object",
  properties: {
    decisions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          action: { enum: ["keep", "edit", "rebuild", "delete"] },
          changes: {
            type: "object",
            description: "edit only: the changed core fields and their new values",
          },
          reason: { type: "string" },
          overruled: {
            type: "string",
            description: "one line, when a REBUILD or DROP was not upheld",
          },
        },
        required: ["id", "action", "reason"],
      },
    },
  },
  required: ["decisions"],
};

function adjudicatePrompt(cards, reviews) {
  return `Adjudicate this batch of instant-composition cards. Read \`${SKILL}/references/adjudication.md\` and follow it; read the guides it names. Write nothing and run no write command.
${note}
Cards:
${JSON.stringify(cards, null, 1)}

R1 blind compositions (by card id):
${JSON.stringify(reviews.blind, null, 1)}

R2 and R3 findings:
${JSON.stringify(reviews.findings, null, 1)}

Return one decision for every card above.`;
}

const APPLIED = {
  type: "object",
  properties: {
    edited: { type: "array", items: { type: "string" } },
    rejected: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, reason: { type: "string" } },
      },
    },
    deleted: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, reason: { type: "string" } },
      },
    },
    rebuilt: {
      type: "array",
      items: {
        type: "object",
        properties: { old: { type: "string" }, new: { type: "string" } },
      },
    },
    rebuildFailed: {
      type: "array",
      items: {
        type: "object",
        properties: { old: { type: "string" }, reason: { type: "string" } },
      },
    },
    cards: {
      type: "array",
      items: { type: "object" },
      description: "the current JSON of every edited card and every new rebuilt card",
    },
    ...STOP,
  },
  required: ["edited", "rejected", "deleted", "rebuilt", "rebuildFailed", "cards"],
};

function applyPrompt(decisions, rebuildFiles, tag) {
  return `Apply these review decisions to content/ in this checkout. Run every command one after another, never two at once. Never hand-edit content/ and never pass --no-verify.

- Edits: write \`[{ "id": …, <changed fields> }]\` for every "edit" below to \`tmp/cards/edits-${tag}.json\`, then \`pnpm -s cards:update tmp/cards/edits-${tag}.json --json\`. Report rejected entries; do not retry them.
- Deletes: \`pnpm -s cards:tombstone --id <id> --reason "<reason>"\` for every "delete".
- Rebuilds: for each rebuild file, \`pnpm -s cards:add <file> --replacing <old> --json\`, then \`pnpm -s cards:tombstone --id <old> --reason "<reason>" --replaced-by <new id>\`. If cards:add drops the new card, instead tombstone the old one with reason \`rebuild failed: <the drop reason>\` and list it under rebuildFailed. A rebuild whose file is missing counts as failed the same way.
- Finally \`pnpm -s cards:show --ids <every edited id and every new rebuilt id> --json\` and return those cards.

Card-level results (ERR_CARDS_LINT, a dropped or rejected card, an "unknown id" line) are results, not failures. Any other ERR_* code: stop at once, change nothing further, and set "stop" to the command and its error. On ERR_CARDS_BUSY, wait a few seconds and rerun the same command.

Decisions:
${JSON.stringify(decisions, null, 1)}

Rebuild files (old id → file): ${JSON.stringify(rebuildFiles)}`;
}

function rebuildPrompt(card, decision, findings, file) {
  return `Write one replacement card for the instant-composition card below. Read \`${WRITER_BRIEF}\` and follow it for 1 card in cell ${card.topic}/${card.subtopic} at level ${card.level}, using target grammar ${JSON.stringify(card.grammar)}. Write the JSON array to \`${file}\`. Run no pnpm cards:* write command.

The card it replaces, and why it is being rebuilt — write a different, better question, not a copy:
${JSON.stringify(card, null, 1)}
Reason: ${decision.reason}
Findings: ${JSON.stringify(
    findings.filter((f) => f.id === card.id),
    null,
    1,
  )}`;
}

const SECOND = {
  type: "object",
  properties: {
    failed: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, reason: { type: "string" } },
        required: ["id", "reason"],
      },
    },
  },
  required: ["failed"],
};

function secondPrompt(cards, reviews) {
  return `Second review round for cards that were edited or rebuilt once already. Read \`${SKILL}/references/adjudication.md\`, section "Second round", and follow it. Write nothing.

Cards:
${JSON.stringify(cards, null, 1)}

R1 blind compositions (by card id):
${JSON.stringify(reviews.blind, null, 1)}

R2 and R3 findings:
${JSON.stringify(reviews.findings, null, 1)}

List every card that fails again, with a one-line reason.`;
}

const FINAL = {
  type: "object",
  properties: {
    stamped: { type: "array", items: { type: "string" } },
    unstamped: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, reason: { type: "string" } },
      },
    },
    deleted: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, reason: { type: "string" } },
      },
    },
    commit: {
      type: "string",
      description: "the commit hash, or empty when nothing was staged",
    },
    ...STOP,
  },
  required: ["stamped", "unstamped", "deleted", "commit"],
};

function finalPrompt(failed, present, summary) {
  return `Finish one review batch in this checkout. Run every command one after another. Never pass --no-verify.

1. For each failed card: \`pnpm -s cards:tombstone --id <id> --reason "failed second review: <reason>"\`.
   Failed: ${JSON.stringify(failed)}
2. \`pnpm -s cards:lint --ids ${present.join(",") || "<none — skip>"}\`, then \`pnpm -s cards:stamp --ids <the same ids>\`. cards:stamp refuses a card that fails lint (ERR_CARDS_STAMP_REFUSED) and stamps the rest; list every refused card under unstamped with its lint finding.
3. \`git add content\`; if \`git diff --cached --quiet\` reports nothing staged, skip the commit. Otherwise \`git commit -m "fix(cards): review ${summary}"\`. If the pre-commit hook fails on something in content/ this batch wrote, fix it with a pnpm cards:* command and commit again; otherwise set "stop".

Card-level results are not failures. Any other ERR_* code, or a hook failure you cannot fix in content/: set "stop" and do nothing further.`;
}

// ---------------------------------------------------------------- prepare

phase("Prepare");
const PREP = {
  type: "object",
  properties: {
    branch: { type: "string" },
    queue: {
      type: "array",
      items: {
        type: "object",
        properties: {
          reason: { type: "string" },
          errors: { type: "array" },
          card: { type: "object" },
        },
        required: ["card"],
      },
    },
    levels: {
      type: "array",
      items: {
        type: "object",
        properties: {
          level: { type: "integer" },
          summary: { type: "string" },
          wordsMin: { type: "integer" },
          wordsMax: { type: "integer" },
        },
        required: ["level", "summary", "wordsMin", "wordsMax"],
      },
    },
    unknownIds: { type: "array", items: { type: "string" } },
    lintErrorsOutside: {
      type: "integer",
      description: "cards with lint ERRORs not in this run (--ids only)",
    },
    ...STOP,
  },
  required: ["branch", "queue", "levels"],
};

const range = [
  a.topic && `topic=${a.topic}`,
  a.subtopic && `subtopic=${a.subtopic}`,
  a.level && `level=${a.level}`,
]
  .filter(Boolean)
  .join(" ");
const ids = Array.isArray(a.ids) ? a.ids : [];
const queueCmd = a.field
  ? `pnpm -s cards:queue --field ${a.field} ${range} --limit ${a.limit ?? 50} --json`
  : `pnpm -s cards:queue ${range} ${ids.length ? `--ids ${ids.join(",")}` : ""} --limit ${a.limit ?? Math.max(50, ids.length)} --json`;

const prep = await agent(
  `Prepare a card review run in this checkout. Read \`${SKILL}/references/branch.md\` and run its branch step first.
Then \`pnpm -s cards:lint\`${ids.length ? " — count the cards with ERRORs that are not among the listed ids and return that as lintErrorsOutside" : ""}.
Then \`${queueCmd.replace(/ +/g, " ")}\` and return its array unchanged as "queue"; list every "unknown id …" stderr line's id under unknownIds.
Also return every level in content/levels.json as { level, summary, wordsMin, wordsMax }.
Any ERR_* failure other than ERR_CARDS_LINT, or a branch stop: set "stop" and do nothing further.`,
  { ...SONNET, label: "prepare", phase: "Prepare", schema: PREP },
);
if (!prep) return { stop: "the prepare agent did not return" };
if (prep.stop) return { stop: prep.stop };

const queued = prep.queue.map((q) => q.card);
log(`${queued.length} cards queued on ${prep.branch}`);
if (!queued.length)
  return { branch: prep.branch, seen: 0, unknownIds: prep.unknownIds ?? [] };

// ---------------------------------------------------------- field review

if (a.field) {
  const FIELD = {
    type: "object",
    properties: {
      verdicts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            action: { enum: ["ok", "edit", "clear"] },
            value: { description: "edit only: the corrected value" },
            reason: { type: "string" },
          },
          required: ["id", "action"],
        },
      },
    },
    required: ["verdicts"],
  };
  const spec = `.claude/skills/backfilling-card-fields/references/fields/${a.field}.md`;
  const results = await pipeline(
    chunk(queued, 20),
    (cards, _b, i) =>
      agent(
        `Review the \`${a.field}\` field of these cards. Read \`${spec}\` and apply its **Review** section, with \`content/guides/writing.md\` as background. Think the problem through before you answer. Write nothing. Return a verdict for every card: ok, edit (with the corrected value) or clear.
${note}
Cards:
${JSON.stringify(cards, null, 1)}`,
        { ...SONNET, label: `field review ${i + 1}`, phase: "Review", schema: FIELD },
      ),
    (r, cards, i) =>
      r &&
      serial(() =>
        agent(
          `Apply field-review verdicts for \`${a.field}\` in this checkout, one command at a time. Never hand-edit content/, never --no-verify, never tombstone a card over this field.
1. Write \`[{ "id": …, "${a.field}": <value> }]\` for every edit, and \`[{ "id": …, "${a.field}": null }]\` for every clear, to \`tmp/cards/${a.field}-review-${i + 1}.json\`; run \`pnpm -s cards:update <file> --json\` if it is non-empty.
2. \`pnpm -s cards:stamp --field ${a.field} --ids <every card below except rejected ones>\`.
3. \`git add content\`; if something is staged, \`git commit -m "fix(cards): review ${a.field} on <n> cards"\`.
Any ERR_* other than a card-level one: set "stop".

Cards: ${JSON.stringify(cards.map((c) => c.id))}
Verdicts: ${JSON.stringify(r.verdicts)}`,
          { ...SONNET, label: `field apply ${i + 1}`, phase: "Apply", schema: FINAL },
        ),
      ),
  );
  const done = results.filter(Boolean);
  const skipped = results.length - done.length;
  if (skipped)
    log(`${skipped} field batches skipped: the reviewer or applier did not return`);
  return {
    branch: prep.branch,
    field: a.field,
    seen: queued.length,
    stamped: done.flatMap((d) => d.stamped),
    unstamped: done.flatMap((d) => d.unstamped),
    batchesSkipped: skipped,
    stop: done.find((d) => d.stop)?.stop,
  };
}

// ------------------------------------------------------------ core review

let stopped = null;

async function runBatch(cards, index) {
  const tag = `batch ${index + 1}`;
  if (stopped) return { tag, skipped: "an earlier batch stopped the run" };

  const first = await review(cards, prep.levels, true, tag);
  if (!first) return { tag, skipped: "a reviewer did not return" };

  const adj = await agent(adjudicatePrompt(cards, first), {
    ...SONNET,
    label: `adjudicate ${tag}`,
    phase: "Adjudicate",
    schema: DECISIONS,
  });
  if (!adj) return { tag, skipped: "the adjudicator did not return" };
  const decisions = adj.decisions;

  const rebuilds = decisions.filter((d) => d.action === "rebuild");
  const rebuildFiles = {};
  await parallel(
    rebuilds.map((d) => () => {
      const card = cards.find((c) => c.id === d.id);
      const file = `tmp/cards/rebuild-${d.id}.json`;
      rebuildFiles[d.id] = file;
      return card
        ? agent(rebuildPrompt(card, d, first.findings, file), {
            ...SONNET,
            label: `rebuild ${d.id}`,
            phase: "Apply",
          })
        : null;
    }),
  );

  const nothingToApply = decisions.every((d) => d.action === "keep");
  const applied = await serial(() =>
    stopped
      ? null
      : nothingToApply
        ? {
            edited: [],
            rejected: [],
            deleted: [],
            rebuilt: [],
            rebuildFailed: [],
            cards: [],
          }
        : agent(applyPrompt(decisions, rebuildFiles, index + 1), {
            ...SONNET,
            label: `apply ${tag}`,
            phase: "Apply",
            schema: APPLIED,
          }),
  );
  if (!applied)
    return { tag, skipped: stopped ?? "the applier did not return", decisions };
  if (applied.stop) {
    stopped = applied.stop;
    return { tag, stop: applied.stop, decisions, applied };
  }

  // Second round: rebuilt cards get all three reviewers, edited cards R1 and
  // R2, plus R3 when the edit touched a tag or the point.
  const TAGGED = ["topic", "subtopic", "level", "grammar", "point"];
  const newIds = new Set(applied.rebuilt.map((r) => r.new));
  const needsR3 = (c) =>
    newIds.has(c.id) ||
    decisions.some(
      (d) =>
        d.id === c.id &&
        d.changes &&
        Object.keys(d.changes).some((k) => TAGGED.includes(k)),
    );
  const again = applied.cards;
  let failed = [];
  if (again.length) {
    const withR3 = again.filter(needsR3);
    const withoutR3 = again.filter((c) => !needsR3(c));
    const rounds = await parallel([
      () =>
        withR3.length
          ? review(withR3, prep.levels, true, `${tag} round 2a`)
          : Promise.resolve({ blind: [], findings: [] }),
      () =>
        withoutR3.length
          ? review(withoutR3, prep.levels, false, `${tag} round 2b`)
          : Promise.resolve({ blind: [], findings: [] }),
    ]);
    if (rounds.some((r) => !r))
      return {
        tag,
        skipped: "a second-round reviewer did not return; nothing stamped",
        decisions,
        applied,
      };
    const merged = {
      blind: rounds.flatMap((r) => r.blind),
      findings: rounds.flatMap((r) => r.findings),
    };
    const second = await agent(secondPrompt(again, merged), {
      ...SONNET,
      label: `second round ${tag}`,
      phase: "Second round",
      schema: SECOND,
    });
    if (!second)
      return {
        tag,
        skipped: "the second-round adjudicator did not return; nothing stamped",
        decisions,
        applied,
      };
    failed = second.failed;
  }

  const gone = new Set([
    ...applied.deleted.map((d) => d.id),
    ...applied.rebuilt.map((r) => r.old),
    ...applied.rebuildFailed.map((r) => r.old),
    ...failed.map((f) => f.id),
  ]);
  const present = [...cards.map((c) => c.id), ...newIds].filter((id) => !gone.has(id));
  const count = (act) => decisions.filter((d) => d.action === act).length;
  const summary = `${cards.length} cards (${count("keep")}/${count("edit")}/${count("rebuild")}/${count("delete") + failed.length})`;

  const final = await serial(() =>
    stopped
      ? null
      : agent(finalPrompt(failed, present, summary), {
          ...SONNET,
          label: `stamp and commit ${tag}`,
          phase: "Apply",
          schema: FINAL,
        }),
  );
  if (final?.stop) stopped = final.stop;
  return { tag, decisions, applied, failed, final };
}

const batches = await pipeline(chunk(queued, BATCH_SIZE), (cards, _item, i) =>
  runBatch(cards, i),
);

phase("Report");
const tally = await agent(
  "Run `pnpm -s cards:queue --count` and return the number it prints.",
  {
    ...SONNET,
    label: "queue count",
    phase: "Report",
    schema: {
      type: "object",
      properties: { count: { type: "integer" } },
      required: ["count"],
    },
  },
);

const done = batches.filter(Boolean);
const decisions = done.flatMap((b) => b.decisions ?? []);
return {
  branch: prep.branch,
  seen: queued.length,
  kept: decisions.filter((d) => d.action === "keep").length,
  edited: done.flatMap((b) => b.applied?.edited ?? []).length,
  rebuilt: done.flatMap((b) => b.applied?.rebuilt ?? []),
  rebuildFailed: done.flatMap((b) => b.applied?.rebuildFailed ?? []),
  deleted: [
    ...done.flatMap((b) => b.applied?.deleted ?? []),
    ...done.flatMap((b) =>
      (b.failed ?? []).map((f) => ({
        id: f.id,
        reason: `failed second review: ${f.reason}`,
      })),
    ),
  ],
  rebuildReasons: decisions
    .filter((d) => d.action === "rebuild")
    .map((d) => ({ id: d.id, reason: d.reason })),
  overruled: decisions
    .filter((d) => d.overruled)
    .map((d) => ({ id: d.id, overruled: d.overruled })),
  rejectedEdits: done.flatMap((b) => b.applied?.rejected ?? []),
  unstamped: done.flatMap((b) => b.final?.unstamped ?? []),
  commits: done.map((b) => b.final?.commit).filter(Boolean),
  batchesSkipped: done
    .filter((b) => b.skipped)
    .map((b) => ({ batch: b.tag, why: b.skipped })),
  unknownIds: prep.unknownIds ?? [],
  lintErrorsOutside: prep.lintErrorsOutside ?? 0,
  stop: stopped,
  queueRemaining: tally?.count,
};
