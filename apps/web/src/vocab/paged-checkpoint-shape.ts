export function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function strings(value: unknown, bound: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= bound &&
    value.every((entry: unknown) => typeof entry === "string")
  );
}
export function natural(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
export function numericMap(value: unknown): boolean {
  return (
    object(value) &&
    Object.keys(value).length <= 80 &&
    Object.values(value).every(natural)
  );
}

export function cardShape(value: unknown): boolean {
  if (!object(value) || !natural(value["slot"]) || !natural(value["page"]))
    return false;
  const card = value["card"];
  return (
    object(card) &&
    ["id", "definition", "example", "headword", "meaning", "example2"].every(
      (key) => typeof card[key] === "string",
    ) &&
    ["word", "idiom", "phrasal-verb", "phrase"].includes(String(card["category"])) &&
    natural(card["level"]) &&
    typeof card["isNew"] === "boolean" &&
    typeof card["personal"] === "boolean" &&
    object(card["intervals"]) &&
    ["again", "hard", "good"].every((key) =>
      natural((card["intervals"] as Record<string, unknown>)[key]),
    )
  );
}
export function phaseShape(value: unknown): boolean {
  if (!object(value)) return false;
  const number = (key: string): boolean =>
    typeof value[key] === "number" && Number.isFinite(value[key]) && value[key] >= 0;
  switch (value["kind"]) {
    case "finishing":
      return true;
    case "front":
      return (
        number("spentMs") &&
        (value["runningSince"] === null || number("runningSince")) &&
        (value["now"] === null || number("now"))
      );
    case "back":
      return (
        ["self", "timeout"].includes(String(value["mode"])) &&
        number("elapsedMs") &&
        number("since")
      );
    case "feedback":
      return (
        ["self", "timeout"].includes(String(value["mode"])) &&
        number("elapsedMs") &&
        ["again", "hard", "good"].includes(String(value["grade"])) &&
        typeof value["fast"] === "boolean"
      );
    default:
      return false;
  }
}
