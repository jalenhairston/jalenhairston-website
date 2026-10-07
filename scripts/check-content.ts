// Validates content/ without Next.js (also proves run-2 scripts can import the loader).
import { getContent } from "../lib/content";

try {
  const c = getContent();
  console.log(
    `content OK: ${c.roles.length} roles, ${c.projects.length} projects, ${c.stories.length} stories, ${c.skills.length} skills` +
      (c.sampleFiles.length ? ` (${c.sampleFiles.length} files still sample)` : ""),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
