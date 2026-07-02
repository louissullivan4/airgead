import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { PRICING, TRIAL_DAYS } from "@/lib/pricing";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Pricing",
  description: `Simple pricing for ${BRAND}: one plan for sole traders, per-client seats for accountancy practices.`,
};

const FAQS = [
  {
    q: "My accountant uses airgead - do I pay?",
    a: "No. When your accountant's practice invited you, your seat is covered by the practice. You pay nothing.",
  },
  {
    q: "What does a practice pay for?",
    a: `Only active client seats - ${PRICING.currency}${PRICING.practice.price}/month each. The practice workspace itself, including your whole team, is free. Seats update automatically when you invite or revoke clients.`,
  },
  {
    q: "Is there a free trial?",
    a: `Yes - every new account gets the full product free for ${TRIAL_DAYS} days. No card required to start.`,
  },
  {
    q: "What happens if I stop paying?",
    a: "Your account becomes read-only: everything you entered stays visible and exportable, you just can't add new records until you subscribe again. We never hold your data hostage.",
  },
];

function PlanCard({
  plan,
  cta,
  highlight = false,
}: {
  plan: (typeof PRICING)["solo"] | (typeof PRICING)["practice"];
  cta: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`flex flex-col rounded-2xl border bg-card p-8 shadow-sm ${
        highlight ? "border-primary ring-1 ring-primary" : "border-border"
      }`}
    >
      <div className="flex items-baseline justify-between">
        <h3 className="text-lg font-semibold">{plan.name}</h3>
        <div className="text-right">
          <span className="text-3xl font-semibold tracking-tight">
            {PRICING.currency}
            {plan.price}
          </span>
          <span className="block text-xs text-muted-foreground">{plan.unit}</span>
        </div>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">{plan.tagline}</p>
      <ul className="mt-6 flex-1 space-y-3">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2.5 text-sm">
            <Check className="mt-0.5 size-4 shrink-0 text-success" /> {f}
          </li>
        ))}
      </ul>
      <Button asChild size="lg" className="mt-8 w-full" vaairgeadt={highlight ? "primary" : "outline"}>
        <Link href="/signup">
          {cta} <ArrowRight />
        </Link>
      </Button>
    </div>
  );
}

export default function PricingPage() {
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

      <main className="flex-1">
        <section className="py-16 sm:py-20">
          <div className="mx-auto w-full max-w-6xl px-5">
            <div className="mx-auto max-w-2xl text-center">
              <h1 className="text-4xl font-semibold tracking-tight">Simple, honest pricing</h1>
              <p className="mt-4 text-lg text-muted-foreground">
                Every account starts with a free {TRIAL_DAYS}-day trial of the full product. No card
                required.
              </p>
            </div>

            <div className="mx-auto mt-12 grid max-w-3xl gap-6 sm:grid-cols-2">
              <PlanCard plan={PRICING.solo} cta="Start free" highlight />
              <PlanCard plan={PRICING.practice} cta="Set up your practice" />
            </div>

            <p className="mx-auto mt-8 max-w-xl text-center text-sm text-muted-foreground">
              Invited by your accountant? Your seat is covered by their practice - the app is free
              for you.
            </p>
          </div>
        </section>

        <section className="border-t border-border bg-muted/30 py-16">
          <div className="mx-auto w-full max-w-3xl px-5">
            <h2 className="text-center text-2xl font-semibold tracking-tight">Common questions</h2>
            <dl className="mt-10 space-y-8">
              {FAQS.map(({ q, a }) => (
                <div key={q}>
                  <dt className="font-semibold">{q}</dt>
                  <dd className="mt-1.5 text-sm text-muted-foreground">{a}</dd>
                </div>
              ))}
            </dl>
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
            <Link href="/" className="hover:text-foreground">
              Home
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
      </footer>
    </div>
  );
}
