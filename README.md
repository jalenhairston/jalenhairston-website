# jalenhairston-website
Personal portfolio site for Jalen Hairston, built with Next.js and TypeScript on Vercel. It includes an AI assistant that answers recruiters' and hiring managers' questions about my experience and projects, using a Postgres/pgvector knowledge base and citing its sources.

## Develop

```bash
npm install
npm run dev            # http://localhost:3000
npm run content:check  # validate content/ without building
npm run typecheck && npm run lint && npm run build
```

All page content lives in `content/` (markdown + YAML frontmatter, validated by `lib/content.ts`).
Files marked `sample: true` are placeholders; while any remain, pages are served with `noindex`.
Quote dates as `"YYYY-MM"`.
