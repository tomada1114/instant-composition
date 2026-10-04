import { readdirSync, lstatSync } from "node:fs";
import path from "node:path";

const owners = [
  "apps/api",
  "packages/domain",
  "packages/application",
  "packages/adapters",
];

/** Compare the reviewed inventory with the actual runtime trees, including new
 * nested modules. Symlinked inputs cannot borrow certification from another file.
 * @param {string} root @param {readonly string[]} declared @returns {boolean}
 */
export function storageRuntimeInventoryMatches(root, declared) {
  const actual = [
    "package.json",
    "pnpm-lock.yaml",
    ...owners.map((owner) => `${owner}/package.json`),
  ];
  /** @param {string} folder @returns {void} */
  function visit(folder) {
    for (const entry of readdirSync(path.join(root, folder), { withFileTypes: true })) {
      const name = `${folder}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new TypeError("Unsupported runtime input.");
      if (entry.isDirectory()) visit(name);
      else if (entry.isFile() && /\.tsx?$/.test(entry.name)) actual.push(name);
      else if (!entry.isFile()) throw new TypeError("Unsupported runtime input.");
    }
  }
  try {
    for (const owner of owners) {
      if (
        owner
          .split("/")
          .some((_, index, parts) =>
            lstatSync(path.join(root, ...parts.slice(0, index + 1))).isSymbolicLink(),
          )
      )
        return false;
      const directory = lstatSync(path.join(root, owner, "src"));
      if (!directory.isDirectory() || directory.isSymbolicLink()) return false;
      visit(`${owner}/src`);
    }
    if (actual.some((file) => !lstatSync(path.join(root, file)).isFile())) return false;
  } catch {
    return false;
  }
  return (
    new Set(declared).size === declared.length &&
    JSON.stringify([...declared].sort()) === JSON.stringify(actual.sort())
  );
}
