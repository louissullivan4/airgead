import Link from "next/link";
import type { ReactNode } from "react";
import { BRAND } from "@/lib/brand";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";

/**
 * Shared marketing-style frame for the static legal pages (/terms, /privacy).
 * Typography relies on semantic HTML + a few utility classes, no CMS.
 */
function LegalShell({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5">
          <Logo href="/" />
          <div className="flex items-center gap-2">
            <Button asChild vaairgeadt="ghost" size="sm">
              <Link href="/login">Log in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/signup">Start free</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 py-12 sm:py-16">
        <article className="mx-auto w-full max-w-3xl px-5">
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">Last updated: {updated}</p>
          <div className="prose-airgead mt-8 space-y-6 text-sm leading-6 text-foreground/90 [&_h2]:mt-10 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5 [&_table]:w-full [&_table]:text-left [&_th]:py-2 [&_th]:pr-4 [&_td]:border-t [&_td]:border-border [&_td]:py-2 [&_td]:pr-4">
            {children}
          </div>
        </article>
      </main>

      <footer className="border-t border-border py-10">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-5 sm:flex-row">
          <Logo href="/" />
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} {BRAND}. All rights reserved.
          </p>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <Link href="/pricing" className="hover:text-foreground">
              Pricing
            </Link>
            <Link href="/terms" className="hover:text-foreground">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-foreground">
              Privacy
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

export { LegalShell };
