// Serve the agent skill from the site so its curl install URL is stable.
import { copyFile } from "node:fs/promises";
import { join } from "node:path";

const siteDir = join(import.meta.dir, "..");
await copyFile(join(siteDir, "..", "skills", "gifcc", "SKILL.md"), join(siteDir, "public", "SKILL.md"));
console.log("Staged SKILL.md");
