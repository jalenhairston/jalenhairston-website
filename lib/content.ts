// Content model: reads content/ (markdown + YAML frontmatter), validates it, and
// checks cross-references. Framework-free so run-2 scripts can import it via tsx.
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { remark } from "remark";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import { z } from "zod";

const yearMonth = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "expected a quoted \"YYYY-MM\" string");
const publicPath = z.string().startsWith("/", "expected a path under /public, starting with /");
const image = z.object({ src: publicPath, alt: z.string().min(1) });

const skillCategories = ["language", "framework", "data", "cloud-devops", "practice", "other"] as const;

const profileSchema = z.object({
  sample: z.boolean(),
  name: z.string().min(1),
  pitch: z.string().min(1).max(140),
  location: z.string().optional(),
  email: z.email().optional(),
  linkedinUrl: z.url().optional(),
  githubUrl: z.url().optional(),
  headshot: image,
  resumePdf: publicPath.optional(),
  education: z.array(
    z.object({
      institution: z.string().min(1),
      credential: z.string().min(1),
      start: yearMonth.optional(),
      end: yearMonth.nullable().optional(),
    }),
  ),
});

const skillsSchema = z.object({
  sample: z.boolean(),
  skills: z.array(
    z.object({
      id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "expected a kebab-case id"),
      name: z.string().min(1),
      category: z.enum(skillCategories),
    }),
  ),
});

const roleSchema = z
  .object({
    sample: z.boolean(),
    company: z.string().min(1),
    title: z.string().min(1),
    start: yearMonth,
    end: yearMonth.nullable(),
    location: z.string().optional(),
    summary: z.string().min(1),
    highlights: z.array(z.string().min(1)),
    skills: z.array(z.string()),
  })
  .refine((r) => r.end === null || r.end >= r.start, { message: "end must not be before start", path: ["end"] });

const projectSchema = z.object({
  sample: z.boolean(),
  name: z.string().min(1),
  summary: z.string().min(1),
  role: z.string().optional(),
  skills: z.array(z.string()),
  links: z.object({ repo: z.url().optional(), live: z.url().optional() }).default({}),
  featured: z.boolean().default(false),
  image: image.optional(),
});

const storySchema = z.object({
  sample: z.boolean(),
  title: z.string().min(1),
  role: z.string(),
  skills: z.array(z.string()),
  situation: z.string().min(1),
  task: z.string().min(1),
  action: z.string().min(1),
  result: z.string().min(1),
});

/** Raw markdown is kept for the knowledge base; html is pre-rendered for pages. */
type Body = { slug: string; body: string; html: string };
type SampleSchema = z.ZodType<{ sample: boolean }>;

export type Skill = z.infer<typeof skillsSchema>["skills"][number];
export type SkillCategory = Skill["category"];
export type Profile = z.infer<typeof profileSchema> & Omit<Body, "slug">;
export type Role = z.infer<typeof roleSchema> & Body;
export type Project = z.infer<typeof projectSchema> & Body;
export type Story = z.infer<typeof storySchema> & Body;
export type Content = {
  profile: Profile;
  skills: Skill[];
  roles: Role[];
  projects: Project[];
  stories: Story[];
  /** Files still flagged `sample: true` (paths like "content/roles/x.md"). */
  sampleFiles: string[];
};

const DEFAULT_DIR = path.join(process.cwd(), "content");
let cached: Content | undefined;

/** Loads and validates all content. Throws one Error listing every problem found. */
export function getContent(dir: string = DEFAULT_DIR): Content {
  if (dir === DEFAULT_DIR && cached) return cached;

  const problems: string[] = [];
  const sampleFiles: string[] = [];
  const rel = (file: string) => path.relative(path.dirname(dir), file).replaceAll("\\", "/");
  const parse = <S extends SampleSchema>(schema: S, file: string) => {
    if (!fs.existsSync(file)) {
      problems.push(`${rel(file)}: file is missing`);
      return undefined;
    }
    const { data, content } = matter(fs.readFileSync(file, "utf8"));
    const result = schema.safeParse(data) as z.ZodSafeParseResult<z.infer<S>>;
    if (!result.success) {
      for (const issue of result.error.issues) problems.push(`${rel(file)}: ${issue.path.join(".") || "(root)"} — ${issue.message}`);
      return undefined;
    }
    if (result.data.sample) sampleFiles.push(rel(file));
    return { ...result.data, body: content.trim(), html: renderMarkdown(content) };
  };
  const collection = <S extends SampleSchema>(schema: S, sub: string) => {
    const folder = path.join(/*turbopackIgnore: true*/ dir, sub);
    if (!fs.existsSync(folder)) return [];
    return fs
      .readdirSync(folder)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .flatMap((f) => {
        const entry = parse(schema, path.join(/*turbopackIgnore: true*/ folder, f));
        return entry ? [{ ...entry, slug: f.slice(0, -".md".length) }] : [];
      });
  };

  const profile = parse(profileSchema, path.join(/*turbopackIgnore: true*/ dir, "profile.md"));
  const skills = parse(skillsSchema, path.join(/*turbopackIgnore: true*/ dir, "skills.md"))?.skills ?? [];
  const roles: Role[] = collection(roleSchema, "roles");
  const projects: Project[] = collection(projectSchema, "projects");
  const stories: Story[] = collection(storySchema, "stories");

  checkIntegrity({ skills, roles, projects, stories }, problems, (sub) => rel(path.join(/*turbopackIgnore: true*/ dir, sub)));
  if (problems.length > 0 || !profile) {
    throw new Error(`Invalid content:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  }

  roles.sort((a, b) => (b.end ?? "9999-12").localeCompare(a.end ?? "9999-12") || b.start.localeCompare(a.start));
  const { body, html, ...profileFields } = profile;
  const content: Content = { profile: { ...profileFields, body, html }, skills, roles, projects, stories, sampleFiles };
  if (dir === DEFAULT_DIR) cached = content;
  return content;
}

type Collections = Pick<Content, "skills" | "roles" | "projects" | "stories">;
function checkIntegrity({ skills, roles, projects, stories }: Collections, problems: string[], rel: (sub: string) => string) {
  const duplicates = (ids: string[]) => ids.filter((id, i) => ids.indexOf(id) !== i);
  for (const id of new Set(duplicates(skills.map((s) => s.id)))) problems.push(`${rel("skills.md")}: duplicate skill id "${id}"`);

  const skillIds = new Set(skills.map((s) => s.id));
  const roleSlugs = new Set(roles.map((r) => r.slug));
  const refs: [string, { slug: string; skills: string[]; role?: string }[]][] = [
    ["roles", roles],
    ["projects", projects],
    ["stories", stories],
  ];
  for (const [folder, entries] of refs) {
    for (const e of entries) {
      for (const id of e.skills) if (!skillIds.has(id)) problems.push(`${rel(`${folder}/${e.slug}.md`)}: skills — unknown skill id "${id}"`);
      if (e.role !== undefined && !roleSlugs.has(e.role)) problems.push(`${rel(`${folder}/${e.slug}.md`)}: role — unknown role slug "${e.role}"`);
    }
  }
}

const markdown = remark().use(remarkRehype).use(rehypeStringify);
function renderMarkdown(source: string): string {
  return String(markdown.processSync(source));
}

export function hasSampleContent(content: Content): boolean {
  return content.sampleFiles.length > 0;
}

const monthYear = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const formatYearMonth = (ym: string) => monthYear.format(new Date(`${ym}-01T00:00:00Z`));

/** "Mar 2021 – Present" style range from YYYY-MM strings; end null means current. */
export function formatDateRange(start: string, end: string | null): string {
  return `${formatYearMonth(start)} – ${end ? formatYearMonth(end) : "Present"}`;
}
