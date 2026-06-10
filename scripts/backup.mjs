// Date-stamped snapshot export of the Convex deployment into backups/.
// Run via `pnpm backup` (or the weekly Task Scheduler job, Sundays 21:00).
// Cost note (verified against Convex limits): generating a backup READS the
// whole database, consuming the free tier's 1 GB/month database bandwidth —
// the same meter the app's own queries use. Weekly cadence keeps backups
// under ~10% of quota through roughly the first year of real operation;
// tighten further (biweekly/monthly) or move to Pro/self-hosted beyond that.
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
