import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { PRICING } from "@/lib/pricing";
import { getPublicPlans, formatPrice } from "@/lib/plans";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Pricing",
  description: `Simple pricing for ${BRAND}: a free trial, then one flat monthly Premium plan.`,
};

// Enforcement + the live Stripe price come from the backend, so render per
// request (the price then tracks whatever is set in the Stripe dashboard).
export const dynamic = "force-dynamic";

function PlanCard({
  name,
  price,
  unit,
  tagline,
  features,
  cta,
  highlight = false,
}: {
  name: string;
  price: string;
  unit?: string;
  tagline: string;
  features: readonly string[];
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
        <h3 className="text-lg font-semibold">{name}</h3>
        <div className="text-right">
          <span className="text-3xl font-semibold tracking-tight">{price}</span>
          {unit && <span className="block text-xs text-muted-foreground">{unit}</span>}
        </div>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">{tagline}</p>
      <ul className="mt-6 flex-1 space-y-3">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2.5 text-sm">
            <Check className="mt-0.5 size-4 shrink-0 text-success" /> {f}
          </li>
        ))}
      </ul>
      <Button asChild size="lg" className="mt-8 w-full" variant={highlight ? "primary" : "outline"}>
        <Link href="/signup">
          {cta} <ArrowRight />
        </Link>
      </Button>
    </div>
  );
}

export default async function PricingPage() {
  const plans = await getPublicPlans();
  const { enforced, trialDays } = plans;
  const premiumPrice = formatPrice(plans.premium, PRICING.premium.fallbackPrice);

  const faqs = enforced
    ? [
        {
          q: "Is there a free trial?",
          a: `Yes - every new account gets the full product free for ${trialDays} days. No card required to start.`,
        },
        {
          q: "What happens after the trial?",
          a: `You move to Premium (${premiumPrice}/month) to keep adding records. Everything you entered always stays viewable and exportable.`,
        },
        {
          q: `My accountant uses ${BRAND} - do I pay?`,
          a: `Yes. You get your own account with a ${trialDays}-day free trial, then Premium (${premiumPrice}/month). Your accountant's practice is free - each client subscribes directly.`,
        },
        {
          q: "What happens if I stop paying?",
          a: "Your account becomes read-only: everything you entered stays visible and exportable, you just can't add new records until you subscribe again. We never hold your data hostage.",
        },
      ]
    : [
        {
          q: "What does it cost?",
          a: `Nothing right now - this is a demo, so the full product is unlocked for everyone. When billing is switched on you'll get a ${trialDays}-day free trial, then Premium at ${premiumPrice}/month.`,
        },
        {
          q: `My accountant uses ${BRAND} - do I pay?`,
          a: `Each client has their own account. It's free during this demo; when billing is switched on you'll get a ${trialDays}-day trial, then Premium at ${premiumPrice}/month. The accountant's practice itself is always free.`,
        },
      ];

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5">
          <Logo href="/" />
          <div className="flex items-center gap-2">
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
        <section className="py-16 sm:py-20">
          <div className="mx-auto w-full max-w-6xl px-5">
            <div className="mx-auto max-w-2xl text-center">
              <h1 className="text-4xl font-semibold tracking-tight">Simple, honest pricing</h1>
              <p className="mt-4 text-lg text-muted-foreground">
                Every account starts with a free {trialDays}-day trial of the full product. No card
                required.
              </p>
            </div>

            {enforced ? (
              <div className="mx-auto mt-12 grid max-w-3xl gap-6 sm:grid-cols-2">
                <PlanCard
                  name={PRICING.free.name}
                  price="€0"
                  unit={`free for ${trialDays} days`}
                  tagline={PRICING.free.tagline}
                  features={PRICING.free.features}
                  cta="Start free"
                />
                <PlanCard
                  name={PRICING.premium.name}
                  price={premiumPrice}
                  unit={PRICING.premium.unit}
                  tagline={PRICING.premium.tagline}
                  features={PRICING.premium.features}
                  cta="Start free"
                  highlight
                />
              </div>
            ) : (
              <div className="mx-auto mt-12 max-w-md">
                <PlanCard
                  name="Free"
                  price="€0"
                  unit="during the demo"
                  tagline="The full product, unlocked for everyone while this demo is running."
                  features={PRICING.free.features}
                  cta="Get started"
                  highlight
                />
              </div>
            )}

            <p className="mx-auto mt-8 max-w-xl text-center text-sm text-muted-foreground">
              Are you an accountant? Your practice is <strong>free</strong> once approved - invite
              clients and manage their books, and they subscribe directly.{" "}
              <Link href="/signup/accountants" className="font-medium text-primary hover:underline">
                For accountants →
              </Link>
            </p>
          </div>
        </section>

        <section className="border-t border-border bg-muted/30 py-16">
          <div className="mx-auto w-full max-w-3xl px-5">
            <h2 className="text-center text-2xl font-semibold tracking-tight">Common questions</h2>
            <dl className="mt-10 space-y-8">
              {faqs.map(({ q, a }) => (
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
