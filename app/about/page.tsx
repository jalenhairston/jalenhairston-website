import type { Metadata } from "next";
import { SkillTags } from "@/components/skill-tags";
import { formatDateRange, getContent } from "@/lib/content";

export function generateMetadata(): Metadata {
  const { name } = getContent().profile;
  const description = `Experience and selected work of ${name}.`;
  return { title: "About", description, openGraph: { title: `About · ${name}`, description } };
}

const starLabels = [
  ["situation", "Situation"],
  ["task", "Task"],
  ["action", "Action"],
  ["result", "Result"],
] as const;

export default function AboutPage() {
  const { profile, roles, stories, skills } = getContent();
  const roleBySlug = new Map(roles.map((r) => [r.slug, r]));

  return (
    <div className="space-y-20 pt-8">
      <section>
        <h1 className="text-5xl font-semibold tracking-tight">About</h1>
        <div className="prose-body mt-6 max-w-2xl text-lg text-muted" dangerouslySetInnerHTML={{ __html: profile.html }} />
      </section>

      <section aria-labelledby="experience-heading">
        <h2 id="experience-heading" className="text-3xl font-semibold tracking-tight">
          Experience
        </h2>
        <ol className="mt-8 space-y-6">
          {roles.map((role) => (
            <li key={role.slug} id={`role-${role.slug}`} className="scroll-mt-8 rounded-card bg-surface p-8 shadow-soft">
              <h3 className="text-xl font-semibold">
                {role.title} · {role.company}
              </h3>
              <p className="mt-1 text-sm text-muted">
                {formatDateRange(role.start, role.end)}
                {role.location && ` · ${role.location}`}
              </p>
              <p className="mt-4">{role.summary}</p>
              {role.highlights.length > 0 && (
                <ul className="mt-4 list-disc space-y-1 pl-5 text-muted">
                  {role.highlights.map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ul>
              )}
              {role.html && <div className="prose-body mt-4 text-muted" dangerouslySetInnerHTML={{ __html: role.html }} />}
              <div className="mt-6">
                <SkillTags ids={role.skills} skills={skills} />
              </div>
            </li>
          ))}
        </ol>
      </section>

      {stories.length > 0 && (
        <section aria-labelledby="selected-work-heading">
          <h2 id="selected-work-heading" className="text-3xl font-semibold tracking-tight">
            Selected work
          </h2>
          <div className="mt-8 space-y-6">
            {stories.map((story) => {
              const role = roleBySlug.get(story.role);
              return (
                <article key={story.slug} id={`story-${story.slug}`} className="scroll-mt-8 rounded-card bg-surface p-8 shadow-soft">
                  <h3 className="text-xl font-semibold">{story.title}</h3>
                  {role && (
                    <p className="mt-1 text-sm text-muted">
                      {role.title} · {role.company}
                    </p>
                  )}
                  <dl className="mt-6 space-y-4">
                    {starLabels.map(([key, label]) => (
                      <div key={key}>
                        <dt className="text-sm font-semibold tracking-wide text-accent uppercase">{label}</dt>
                        <dd className="mt-1">{story[key]}</dd>
                      </div>
                    ))}
                  </dl>
                  {story.html && <div className="prose-body mt-4 text-muted" dangerouslySetInnerHTML={{ __html: story.html }} />}
                  <div className="mt-6">
                    <SkillTags ids={story.skills} skills={skills} />
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
