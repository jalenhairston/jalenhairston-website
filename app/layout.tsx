import type { Metadata } from "next";
import Link from "next/link";
import { Geist } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { AskBarSlot } from "@/components/ask-bar-slot";
import { MenuPill } from "@/components/menu-pill";
import { getContent, hasSampleContent } from "@/lib/content";
import "./globals.css";

// Every route must be fully prerendered (NFR: static generation).
export const ensureStatic = "navigation";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export function generateMetadata(): Metadata {
  const content = getContent();
  const { name, pitch } = content.profile;
  return {
    title: { default: name, template: `%s · ${name}` },
    description: pitch,
    openGraph: { title: name, description: pitch, type: "website" },
    // Keep sample scaffolding out of search results until real content lands.
    robots: hasSampleContent(content) ? { index: false, follow: false } : undefined,
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { name } = getContent().profile;
  return (
    <html lang="en" className={`${geistSans.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <a
          href="#main"
          className="sr-only rounded-pill bg-accent px-4 py-2 text-accent-ink focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50"
        >
          Skip to content
        </a>
        <header data-print-hide className="mx-auto flex w-full max-w-content items-center justify-between px-6 py-6">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            {name}
          </Link>
          <MenuPill />
        </header>
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-content flex-1 px-6 outline-none">
          {children}
        </main>
        <footer data-print-hide className="mx-auto w-full max-w-content px-6 py-8 text-sm text-muted">
          © {name}
        </footer>
        <AskBarSlot />
        <Analytics />
      </body>
    </html>
  );
}
