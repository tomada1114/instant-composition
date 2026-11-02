import process from "node:process";
import {
  backupOptions,
  backupPort,
  runBackup,
  StorageBackupError,
} from "./lib/storage-backup.mjs";
/** @param {string[]} args @returns {Promise<unknown>} */
export async function main(args) {
  const options = backupOptions(args);
  return runBackup(options, backupPort(options));
}
if (import.meta.main) {
  try {
    process.stdout.write(`${JSON.stringify(await main(process.argv.slice(2)))}\n`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof StorageBackupError ? error.message : new StorageBackupError("ERR_STORAGE_BACKUP_FAILED").message}\n`,
    );
    process.exitCode = 1;
  }
}
