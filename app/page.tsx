import Image from "next/image";
import Link from "next/link";
import { ContactLinks } from "@/components/contact-links";
import { SkillTags } from "@/components/skill-tags";
import { getContent } from "@/lib/content";

export default function HomePage() {
  const { profile, roles, projects, skills } = getContent();
  const currentRole = roles[0];
  const featured = projects.filter((p) => p.featured).slice(0, 3);

  const highlights = [
    {
      href: "/about",
      headline: "Experience and selected work.",
      body: "Roles, impact, and the stories behind the projects.",
      linkLabel: "Read about my work",
      visual: currentRole && (
        <>
          <p className="text-sm text-muted">Currently</p>
          <p className="mt-1 text-xl font-semibold">{currentRole.title}</p>
          <p className="text-muted">{currentRole.company}</p>
        </>
      ),
    },
    {
      href: "/resume",
      headline: "The one-page version.",
      body: "Experience, skills, and education at a glance.",
      linkLabel: "View resume",
      visual: <SkillTags ids={skills.slice(0, 6).map((s) => s.id)} skills={skills} />,
    },
  ];

  return (
    <>
      <section className="flex flex-col items-center pt-10 pb-16 text-center sm:pt-16">
        <Image
          src={profile.headshot.src}
          alt={profile.headshot.alt}
          width={160}
          height={160}
          priority
          unoptimized={profile.headshot.src.endsWith(".svg")}
          className="size-32 rounded-card object-cover shadow-soft sm:size-40"
        />
        <h1 className="mt-8 text-5xl font-semibold tracking-tight sm:text-6xl">{profile.name}</h1>
        <p className="mt-4 max-w-xl text-lg text-muted sm:text-xl">{profile.pitch}</p>
        <ContactLinks profile={profile} className="mt-8 justify-center" />
      </section>

      <section aria-label="Highlights" className="space-y-16 py-8">
        {highlights.map((h, i) => (
          <div key={h.href} className="grid items-center gap-8 md:grid-cols-2 md:gap-16">
            <div className={`rounded-card bg-surface p-10 shadow-soft ${i % 2 === 1 ? "md:order-2" : ""}`}>{h.visual}</div>
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">{h.headline}</h2>
              <p className="mt-3 text-muted">{h.body}</p>
              <Link href={h.href} className="mt-4 inline-block font-semibold underline-offset-4 hover:underline">
                {h.linkLabel}
              </Link>
            </div>
          </div>
        ))}
      </section>

      {featured.length > 0 && (
        <section aria-labelledby="featured-heading" className="py-16">
          <h2 id="featured-heading" className="text-center text-3xl font-semibold tracking-tight">
            Featured projects
          </h2>
          <ul className="mt-10 grid gap-6 md:grid-cols-3">
            {featured.map((p) => (
              <li key={p.slug} className="flex flex-col gap-4 rounded-card bg-surface p-8 shadow-soft">
                <h3 className="text-lg font-semibold">{p.name}</h3>
                <p className="flex-1 text-sm text-muted">{p.summary}</p>
                <SkillTags ids={p.skills} skills={skills} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
