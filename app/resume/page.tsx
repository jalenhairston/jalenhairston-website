import type { Metadata } from "next";
import { ContactLinks } from "@/components/contact-links";
import { formatDateRange, getContent, type SkillCategory } from "@/lib/content";

export function generateMetadata(): Metadata {
  const { name } = getContent().profile;
  const description = `Resume of ${name}: experience, skills, and education.`;
  return { title: "Resume", description, openGraph: { title: `Resume · ${name}`, description } };
}

const categoryLabels: Record<SkillCategory, string> = {
  language: "Languages",
  framework: "Frameworks",
  data: "Data",
  "cloud-devops": "Cloud & DevOps",
  practice: "Practices",
  other: "Other",
};

export default function ResumePage() {
  const { profile, roles, skills } = getContent();
  const skillGroups = Object.entries(categoryLabels)
    .map(([category, label]) => ({ label, names: skills.filter((s) => s.category === category).map((s) => s.name) }))
    .filter((g) => g.names.length > 0);

  return (
    <article className="mx-auto max-w-3xl space-y-12 pt-8">
      <header className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight">{profile.name}</h1>
          <p className="mt-2 text-muted">{profile.pitch}</p>
          {profile.location && <p className="mt-1 text-sm text-muted">{profile.location}</p>}
          <ContactLinks profile={profile} className="mt-4" />
        </div>
        {profile.resumePdf && (
          <a
            href={profile.resumePdf}
            download
            data-print-hide
            className="shrink-0 self-start rounded-pill bg-accent px-5 py-2 text-sm font-semibold text-accent-ink"
          >
            Download PDF
          </a>
        )}
      </header>

      <section id="experience" aria-labelledby="resume-experience" className="scroll-mt-8">
        <h2 id="resume-experience" className="border-b border-line pb-2 text-xl font-semibold">
          Experience
        </h2>
        <ol className="mt-6 space-y-8">
          {roles.map((role) => (
            <li key={role.slug}>
              <div className="flex flex-col justify-between gap-1 sm:flex-row sm:items-baseline">
                <h3 className="font-semibold">
                  {role.title} · {role.company}
                </h3>
                <p className="text-sm text-muted">{formatDateRange(role.start, role.end)}</p>
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
                {role.highlights.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </section>

      <section id="skills" aria-labelledby="resume-skills" className="scroll-mt-8">
        <h2 id="resume-skills" className="border-b border-line pb-2 text-xl font-semibold">
          Skills
        </h2>
        <dl className="mt-6 grid gap-3 sm:grid-cols-[10rem_1fr]">
          {skillGroups.map((g) => (
            <div key={g.label} className="contents">
              <dt className="font-semibold">{g.label}</dt>
              <dd className="text-muted">{g.names.join(", ")}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section id="education" aria-labelledby="resume-education" className="scroll-mt-8">
        <h2 id="resume-education" className="border-b border-line pb-2 text-xl font-semibold">
          Education
        </h2>
        <ul className="mt-6 space-y-3">
          {profile.education.map((e) => (
            <li key={`${e.institution}-${e.credential}`} className="flex flex-col justify-between gap-1 sm:flex-row sm:items-baseline">
              <span>
                <span className="font-semibold">{e.credential}</span> · {e.institution}
              </span>
              {e.start && <span className="text-sm text-muted">{formatDateRange(e.start, e.end ?? null)}</span>}
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
