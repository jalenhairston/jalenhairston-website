import type { Skill } from "@/lib/content";

type Props = { ids: string[]; skills: Skill[] };

/** Skill ids rendered as pill tags with their display names. */
export function SkillTags({ ids, skills }: Props) {
  if (ids.length === 0) return null;
  const nameById = new Map(skills.map((s) => [s.id, s.name]));
  return (
    <ul aria-label="Skills" className="flex flex-wrap gap-2">
      {ids.map((id) => (
        <li key={id} className="rounded-pill bg-tag px-3 py-1 text-xs font-medium text-muted">
          {nameById.get(id) ?? id}
        </li>
      ))}
    </ul>
  );
}
