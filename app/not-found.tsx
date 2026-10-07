import Link from "next/link";

export default function NotFound() {
  return (
    <section className="flex flex-col items-center py-24 text-center">
      <h1 className="text-5xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-4 text-lg text-muted">That page doesn&apos;t exist.</p>
      <Link href="/" className="mt-8 rounded-pill bg-accent px-5 py-2 font-semibold text-accent-ink">
        Back home
      </Link>
    </section>
  );
}
