import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { repoRoot, runNode } from "../scripts/lib/node-tools.mjs";
import { isShown } from "../scripts/cards/schema.mjs";
import { prettierAt, prettierFormatter } from "../scripts/cards/store.mjs";
import {
  jsonOut,
  makeContentRoot,
  makeInput,
  removeContentRoots,
  runCards,
  writeCards,
  writeInput,
  writeUnder,
} from "./cards-fixture";

// One card set taken through its whole life with the real formatter, the way
// the skills drive it: add → lint → queue → stamp → shown → update (hash
// changes, so it is re-queued and hidden) → tombstone (the id is never
// reusable). The in-process suite covers each command's branches; this one
// checks that the steps compose and that what they write is exactly what
// Prettier would, so `pnpm format:check` and the pre-commit hook never rewrite
// a card file behind the commands' backs.

afterEach(() => {
  removeContentRoots();
});

const cli = fileURLToPath(new URL("../scripts/cards/cli.mjs", import.meta.url));
const prettier = path.join(repoRoot, "node_modules", "prettier", "bin", "prettier.cjs");

const INPUT = [
  makeInput(),
  makeInput({
    subtopic: "requests",
    ja: "この資料、明日までに確認してもらえますか？",
    en: "Could you check these documents by tomorrow?",
    alternatives: [
      "Can you look over these documents by tomorrow?",
      "Would you be able to review these by tomorrow?",
    ],
    point: "by は期限、until は継続",
    level: 3,
    grammar: ["requests-permission"],
  }),
  makeInput({
    topic: "daily",
    subtopic: "home",
    ja: "もう洗濯物を取り込んだ？",
    en: "Have you brought in the laundry yet?",
    alternatives: [
      "Did you bring the laundry in yet?",
      "Have you taken in the laundry?",
    ],
    point: "もう → yet と現在完了",
    level: 3,
    grammar: ["present-perfect"],
  }),
];

interface Shown {
  id: string;
  ja: string;
  en: string;
  alternatives: string[];
  point: string;
  topic: string;
  subtopic: string;
  level: number;
  grammar: string[];
  stamps: unknown;
}

function cards(root: string): Shown[] {
  return jsonOut(runCards(root, ["show", "--json"])) as Shown[];
}

describe("a card set's life through the cards:* commands", () => {
  it("adds, reviews, edits and deletes cards the way the skills do", () => {
    const root = makeContentRoot();
    const options = { formatter: prettierFormatter };

    const added = runCards(
      root,
      ["add", writeInput(root, "new.json", INPUT), "--json"],
      options,
    );
    const { admitted } = jsonOut(added) as { admitted: { id: string }[] };
    expect(admitted).toHaveLength(3);
    const ids = admitted.map((card) => card.id);

    // Prettier-identical output: a check run over the written files passes.
    const check = runNode(prettier, [
      "--config",
      path.join(repoRoot, ".prettierrc.json"),
      "--check",
      path.join(root, "cards"),
    ]);
    expect(check.status).toBe(0);
    // Prettier collapses the short arrays onto one line.
    expect(
      readFileSync(path.join(root, "cards", "work", "meetings.json"), "utf8"),
    ).toContain('"grammar": ["imperatives"],');

    expect(runCards(root, ["lint"]).code).toBe(0);
    expect(runCards(root, ["queue", "--count"]).out).toBe("3");
    expect(cards(root).some((card) => isShown(card))).toBe(false);

    expect(runCards(root, ["stamp", "--ids", ids.join(",")], options).code).toBe(0);
    expect(cards(root).every((card) => isShown(card))).toBe(true);
    expect(runCards(root, ["queue", "--count"]).out).toBe("0");

    const [edited = "", deleted = "", replacement = ""] = ids;
    const edits = writeInput(root, "edits.json", [
      { id: edited, en: "Let's begin the meeting." },
    ]);
    expect(runCards(root, ["update", edits], options).out).toMatch(
      /1 updated, 0 rejected/u,
    );
    const after = cards(root);
    expect(after.find((card) => card.id === edited)).toSatisfy(
      (card: Shown) => !isShown(card),
    );
    expect(runCards(root, ["queue"]).out).toMatch(
      new RegExp(`^${edited} {2}changed `, "mu"),
    );

    const tombstoned = runCards(
      root,
      [
        "tombstone",
        "--id",
        deleted,
        "--reason",
        "duplicate: test",
        "--replaced-by",
        replacement,
      ],
      options,
    );
    expect(tombstoned.code).toBe(0);
    expect(cards(root).map((card) => card.id)).not.toContain(deleted);
    expect(runCards(root, ["show", "--tombstones", "--brief"]).out).toBe(
      "この資料、明日までに確認してもらえますか？ ⟶ Could you check these documents by tomorrow?",
    );

    // The id is never reusable: a card carrying it by hand fails lint, and the
    // id generator treats it as taken.
    writeCards(root, "work/requests.json", [
      { ...INPUT[1], id: deleted, createdAt: "2026-09-22", stamps: {} },
    ]);
    expect(runCards(root, ["lint"]).out).toContain(`${deleted} ID_TOMBSTONED`);
    const fresh = runCards(root, ["new-id", "50"]).out.split("\n");
    expect(fresh).not.toContain(deleted);
  });

  it("runs as a command and exits non-zero on a lint error", () => {
    const root = makeContentRoot();
    writeUnder(root, "cards/work/meetings.json", "[1]\n");
    const failed = runNode(cli, ["lint", "--root", root]);
    expect(failed.status).toBe(1);
    expect(failed.stderr).toMatch(/^ERR_CARDS_LINT: /mu);
    expect(failed.stderr).toMatch(/^Next: /mu);

    writeUnder(root, "cards/work/meetings.json", "[]\n");
    const passed = runNode(cli, ["lint", "--root", root]);
    expect(passed.status).toBe(0);
    expect(passed.stdout).toBe("cards:lint: 0 cards checked, 0 errors\n");
  });

  it("reports a formatter failure as ERR_CARDS_FORMATTER", () => {
    const root = makeContentRoot();
    writeUnder(root, "broken.json", "{");
    expect(() => {
      prettierFormatter.format([path.join(root, "broken.json")]);
    }).toThrow(expect.objectContaining({ code: "ERR_CARDS_FORMATTER" }));
  });

  it("formats nothing when nothing was written", () => {
    expect(prettierFormatter.format([])).toBeUndefined();
  });

  it("reports a missing Prettier before anything is written", () => {
    const root = makeContentRoot();
    const run = runCards(root, ["add", writeInput(root, "new.json", INPUT)], {
      formatter: prettierAt(path.join(root, "no-prettier.cjs")),
    });
    expect(run.code).toBe(1);
    expect(run.err).toMatch(/^ERR_CARDS_FORMATTER: /mu);
    expect(existsSync(path.join(root, "cards"))).toBe(false);
  });
});
