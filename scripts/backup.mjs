// Date-stamped snapshot export of the Convex deployment into backups/.
// Run via `pnpm backup` (or the nightly Task Scheduler job).
// Cost note: export size × frequency = egress against the Convex bandwidth
// quota — trivial at this project's scale (~KB snapshots), revisit cadence
// if the database ever reaches tens of MB.
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const stamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
const dir = join(root, "backups");
mkdirSync(dir, { recursive: true });
const path = join(dir, `backup-${stamp}.zip`);

const result = spawnSync("npx", ["convex", "export", "--path", path], {
  cwd: root,
  stdio: "inherit",
  shell: true,
});
process.exit(result.status ?? 1);
