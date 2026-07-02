import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Camera, Check, FileDown, Sparkles } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { DashboardPreview } from "@/components/landing/dashboard-preview";

export const metadata: Metadata = {
  title: { absolute: `${BRAND} - expense & receipt tracking for freelancers` },
};

const FEATURES = [
  {
    icon: Camera,
    title: "Snap & store receipts",
    body: "Photograph a receipt and rian attaches it to the expense - stored safely and exportable anytime.",
  },
  {
    icon: Sparkles,
    title: "Auto-categorized",
    body: "Every expense lands in the right category, so your spending breakdown stays up to date on its own.",
  },
  {
    icon: FileDown,
    title: "Tax-ready exports",
    body: "Download a clean archive of your records and receipts for the whole tax year in a single click.",
  },
];

const STEPS = [
  { n: "1", title: "Snap a receipt", body: "Add an expense in seconds, with the receipt attached." },
  { n: "2", title: "We organize it", body: "It's categorized and totaled automatically." },
  { n: "3", title: "Export at tax time", body: "One click for a tidy, tax-ready archive." },
];

const PLAN_FEATURES = [
  "Unlimited expenses & income",
  "Receipt capture & storage",
  "Automatic categories",
  "Tax-year ZIP export",
  "Multi-currency (EUR, GBP, USD)",
];

export default function LandingPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5">
          <Logo href="/" />
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
              <Link href="/signup">For accountants</Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
              <Link href="/pricing">Pricing</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/login">Log in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/signup">Start free</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-40 -z-10 flex justify-center">
            <div className="size-[40rem] rounded-full bg-primary/10 blur-3xl" />
          </div>
          <div className="mx-auto grid w-full max-w-6xl gap-12 px-5 py-16 lg:grid-cols-2 lg:items-center lg:py-24">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                <Sparkles className="size-3.5 text-primary" /> For freelancers &amp; sole traders
              </span>
              <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl">
                Turn receipts into tax-ready records.
              </h1>
              <p className="mt-4 max-w-md text-lg text-muted-foreground">
                Snap a receipt and {BRAND} logs it, categorizes it, and keeps it ready for tax
                season. The boring part, handled.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg">
                  <Link href="/signup">
                    Start for free <ArrowRight />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link href="/login">Log in</Link>
                </Button>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">Free to start · No card required</p>
            </div>
            <div className="lg:pl-4">
              <DashboardPreview />
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="border-t border-border bg-muted/30 py-16 sm:py-24">
          <div className="mx-auto w-full max-w-6xl px-5">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-semibold tracking-tight">
                Everything you need, nothing you don&apos;t
              </h2>
              <p className="mt-3 text-muted-foreground">
                Track expenses without the spreadsheet gymnastics.
              </p>
            </div>
            <div className="mt-12 grid gap-5 sm:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, body }) => (
                <div key={title} className="rounded-xl border border-border bg-card p-6 shadow-sm">
                  <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-5" />
                  </span>
                  <h3 className="mt-4 font-semibold">{title}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="py-16 sm:py-24">
          <div className="mx-auto w-full max-w-6xl px-5">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-semibold tracking-tight">
                From receipt to records in three steps
              </h2>
              <p className="mt-3 text-muted-foreground">
                Managing a whole client book? Accountants get every client&apos;s records in one place,
                ready to export at tax time.
              </p>
            </div>
            <div className="mt-12 grid gap-8 sm:grid-cols-3">
              {STEPS.map(({ n, title, body }) => (
                <div key={n} className="text-center">
                  <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-primary text-lg font-semibold text-primary-foreground">
                    {n}
                  </span>
                  <h3 className="mt-4 font-semibold">{title}</h3>
                  <p className="mx-auto mt-1.5 max-w-xs text-sm text-muted-foreground">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section className="border-t border-border bg-muted/30 py-16 sm:py-24">
          <div className="mx-auto w-full max-w-6xl px-5">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-semibold tracking-tight">Simple pricing</h2>
              <p className="mt-3 text-muted-foreground">
                {BRAND} is free while we&apos;re getting started - no card, no catch.
              </p>
            </div>
            <div className="mx-auto mt-12 max-w-md">
              <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-lg font-semibold">Free</h3>
                  <span className="text-3xl font-semibold tracking-tight">€0</span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Everything you need to track expenses and stay tax-ready.
                </p>
                <ul className="mt-6 space-y-3">
                  {PLAN_FEATURES.map((f) => (
                    <li key={f} className="flex items-center gap-2.5 text-sm">
                      <Check className="size-4 shrink-0 text-success" /> {f}
                    </li>
                  ))}
                </ul>
                <Button asChild size="lg" className="mt-8 w-full">
                  <Link href="/signup">Get started</Link>
                </Button>
              </div>
              <p className="mt-4 text-center text-sm text-muted-foreground">
                Wondering what it will cost later?{" "}
                <Link href="/pricing" className="font-medium text-foreground underline underline-offset-2 hover:no-underline">
                  See pricing
                </Link>
              </p>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="py-16 sm:py-24">
          <div className="mx-auto w-full max-w-5xl px-5">
            <div className="relative overflow-hidden rounded-3xl bg-primary px-6 py-14 text-center text-primary-foreground sm:px-12">
              <div aria-hidden className="pointer-events-none absolute -right-20 -top-20 size-72 rounded-full bg-white/10 blur-3xl" />
              <h2 className="relative text-3xl font-semibold tracking-tight sm:text-4xl">
                Stop dreading receipts.
              </h2>
              <p className="relative mx-auto mt-3 max-w-md text-primary-foreground/85">
                Set up your account in under a minute and start capturing expenses today.
              </p>
              <div className="relative mt-8 flex justify-center">
                <Button
                  asChild
                  size="lg"
                  className="border-transparent bg-white text-primary hover:bg-white/90"
                >
                  <Link href="/signup">
                    Start for free <ArrowRight />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </section>
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
            <Link href="/login" className="hover:text-foreground">
              Log in
            </Link>
          </div>
        </div>
        <p className="mx-auto mt-4 w-full max-w-6xl px-5 text-center text-xs text-muted-foreground sm:text-left">
          Essential cookies only - no tracking.
        </p>
      </footer>
    </div>
  );
}
