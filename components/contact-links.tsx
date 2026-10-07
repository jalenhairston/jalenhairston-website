import type { Profile } from "@/lib/content";

type Props = { profile: Pick<Profile, "email" | "linkedinUrl" | "githubUrl">; className?: string };

/** Email / LinkedIn / GitHub links; any field missing from the profile is omitted. */
export function ContactLinks({ profile, className = "" }: Props) {
  const links = [
    profile.email && { href: `mailto:${profile.email}`, label: "Email", external: false },
    profile.linkedinUrl && { href: profile.linkedinUrl, label: "LinkedIn", external: true },
    profile.githubUrl && { href: profile.githubUrl, label: "GitHub", external: true },
  ].filter((l) => !!l);

  if (links.length === 0) return null;
  return (
    <ul aria-label="Contact" className={`flex flex-wrap gap-3 ${className}`}>
      {links.map(({ href, label, external }) => (
        <li key={label}>
          <a
            href={href}
            {...(external && { target: "_blank", rel: "noopener noreferrer" })}
            className="inline-block rounded-pill border border-line bg-surface px-4 py-2 text-sm font-medium hover:border-accent"
          >
            {label}
            {external && <span className="sr-only"> (opens in a new tab)</span>}
          </a>
        </li>
      ))}
    </ul>
  );
}
