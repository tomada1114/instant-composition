import { executeStorageMaintenance } from "@instant-composition/adapters";
import { validateStoredRecords } from "./storage-maintenance";

// Operator-only subprocess; no environment reads and no HTTP endpoint.
// The parent privately consumes stdout and logs only fixed errors/counters.
async function answer(body: string): Promise<void> {
  try {
    const input: unknown = JSON.parse(body);
    const result = Array.isArray(input)
      ? validateStoredRecords(input)
      : { ok: true, result: await executeStorageMaintenance(input) };
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stdout.write(
      `${JSON.stringify({ ok: false, code: "ERR_STORAGE_SHAPE" })}\n`,
    );
  }
}

process.stdin.setEncoding("utf8");
let body = "";
for await (const chunk of process.stdin) {
  body += String(chunk);
  if (body.length > 8 * 1024 * 1024) {
    process.exitCode = 1;
    break;
  }
  let newline = body.indexOf("\n");
  while (newline >= 0) {
    await answer(body.slice(0, newline));
    body = body.slice(newline + 1);
    newline = body.indexOf("\n");
  }
}
if (body.trim() !== "" && process.exitCode !== 1) await answer(body);
