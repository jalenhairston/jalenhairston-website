import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatDateRange, getContent, hasSampleContent } from "./content";

// Each test writes a minimal valid content tree to a temp dir, then breaks one thing.
const base: Record<string, string> = {
  "profile.md": `---
sample: false
name: "Test Person"
pitch: "Builds things."
headshot: { src: "/me.jpg", alt: "Test Person" }
education: []
---
Hello **world**.
`,
  "skills.md": `---
sample: false
skills:
  - { id: java, name: "Java", category: language }
  - { id: kafka, name: "Kafka", category: data }
---
`,
  "roles/current.md": `---
sample: false
company: "Now Co"
title: "Engineer"
start: "2022-01"
end: null
summary: "Current role."
highlights: []
skills: [java]
---
`,
  "roles/old.md": `---
sample: false
company: "Then Co"
title: "Junior"
start: "2018-01"
end: "2021-12"
summary: "Old role."
highlights: []
skills: [kafka]
---
`,
  "stories/s.md": `---
sample: false
title: "Story"
role: current
skills: [java]
situation: "S"
task: "T"
action: "A"
result: "R"
---
`,
};

const dirs: string[] = [];
function tree(overrides: Record<string, string | null> = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "content-test-"));
  dirs.push(root);
  const dir = path.join(root, "content");
  for (const [file, body] of Object.entries({ ...base, ...overrides })) {
    if (body === null) continue;
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), body);
  }
  return dir;
}
const edit = (file: string, from: string, to: string) => ({ [file]: base[file].replace(from, to) });
const problemsOf = (dir: string) => {
  try {
    getContent(dir);
  } catch (e) {
    expect((e as Error).message).toMatch(/^Invalid content:/);
    return (e as Error).message;
  }
  throw new Error("expected getContent to throw");
};

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("getContent — valid content", () => {
  it("loads typed collections with slugs from filenames and rendered markdown", () => {
    const c = getContent(tree());
    expect(c.profile.name).toBe("Test Person");
    expect(c.profile.html).toContain("<strong>world</strong>");
    expect(c.profile.body).toBe("Hello **world**.");
    expect(c.stories.map((s) => s.slug)).toEqual(["s"]);
    expect(c.projects).toEqual([]); // missing optional folder is fine
  });

  it("orders roles current-first, then by most recent end", () => {
    const c = getContent(tree({ "roles/a-mid.md": base["roles/old.md"].replace('"2021-12"', '"2023-06"').replace('"2018-01"', '"2021-01"') }));
    expect(c.roles.map((r) => r.slug)).toEqual(["current", "a-mid", "old"]);
  });

  it("loads the repo's sample content", () => {
    const c = getContent();
    expect(c.roles.length).toBeGreaterThanOrEqual(2);
    expect(c.projects.some((p) => p.featured)).toBe(true);
    expect(c.stories.length).toBeGreaterThanOrEqual(1);
  });
});

describe("getContent — validation errors name the file and field", () => {
  it("missing required field", () => {
    expect(problemsOf(tree(edit("roles/old.md", 'company: "Then Co"\n', "")))).toMatch(/content\/roles\/old\.md: company/);
  });

  it("wrong type", () => {
    expect(problemsOf(tree(edit("roles/old.md", "highlights: []", "highlights: nope")))).toMatch(/content\/roles\/old\.md: highlights/);
  });

  it("unquoted full date (YAML turns it into a Date)", () => {
    expect(problemsOf(tree(edit("roles/old.md", 'start: "2018-01"', "start: 2018-01-15")))).toMatch(/roles\/old\.md: start/);
  });

  it("end before start", () => {
    expect(problemsOf(tree(edit("roles/old.md", 'end: "2021-12"', 'end: "2017-01"')))).toMatch(/roles\/old\.md: end — end must not be before start/);
  });

  it("pitch longer than 140 chars", () => {
    expect(problemsOf(tree(edit("profile.md", '"Builds things."', `"${"x".repeat(141)}"`)))).toMatch(/profile\.md: pitch/);
  });

  it("missing profile file", () => {
    expect(problemsOf(tree({ "profile.md": null }))).toMatch(/content\/profile\.md: file is missing/);
  });

  it("reports every problem at once, not just the first", () => {
    const message = problemsOf(tree({ ...edit("roles/old.md", "skills: [kafka]", "skills: [nope]"), ...edit("stories/s.md", "role: current", "role: ghost") }));
    expect(message).toMatch(/roles\/old\.md: skills — unknown skill id "nope"/);
    expect(message).toMatch(/stories\/s\.md: role — unknown role slug "ghost"/);
  });
});

describe("getContent — cross-reference integrity", () => {
  it("dangling skill id", () => {
    expect(problemsOf(tree(edit("stories/s.md", "skills: [java]", "skills: [rust]")))).toMatch(/stories\/s\.md: skills — unknown skill id "rust"/);
  });

  it("dangling role slug on a project", () => {
    const project = `---\nsample: false\nname: "P"\nsummary: "S"\nrole: ghost\nskills: []\n---\n`;
    expect(problemsOf(tree({ "projects/p.md": project }))).toMatch(/projects\/p\.md: role — unknown role slug "ghost"/);
  });

  it("duplicate skill id", () => {
    expect(problemsOf(tree(edit("skills.md", "{ id: kafka,", "{ id: java,")))).toMatch(/skills\.md: duplicate skill id "java"/);
  });
});

describe("markdown rendering", () => {
  it("does not pass raw HTML from content through to pages", () => {
    const c = getContent(tree({ "profile.md": base["profile.md"].replace("Hello **world**.", 'Hi <script>alert(1)</script><img src=x onerror="alert(1)">') }));
    expect(c.profile.html).not.toMatch(/<script|onerror/);
  });
});

describe("hasSampleContent", () => {
  it("is false when nothing is flagged sample", () => {
    expect(hasSampleContent(getContent(tree()))).toBe(false);
  });

  it("is true when any file, including skills.md, is flagged sample", () => {
    const c = getContent(tree(edit("skills.md", "sample: false", "sample: true")));
    expect(hasSampleContent(c)).toBe(true);
    expect(c.sampleFiles).toEqual(["content/skills.md"]);
  });
});

describe("formatDateRange", () => {
  it("formats month ranges and uses Present for a current role", () => {
    expect(formatDateRange("2021-03", "2022-12")).toBe("Mar 2021 – Dec 2022");
    expect(formatDateRange("2022-01", null)).toBe("Jan 2022 – Present");
  });

  it("is not shifted by the machine timezone at month boundaries", () => {
    expect(formatDateRange("2020-01", "2020-12")).toBe("Jan 2020 – Dec 2020");
  });
});
