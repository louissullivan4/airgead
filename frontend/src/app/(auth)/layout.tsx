import type { ReactNode } from "react";
import Link from "next/link";
import { Camera, FileDown, Sparkles } from "lucide-react";
import { Logo } from "@/components/logo";
import { BRAND } from "@/lib/brand";

const FEATURES = [
  { icon: Camera, text: "Snap a receipt and we'll log the expense." },
  { icon: Sparkles, text: "Auto-categorized so your books stay tidy." },
  { icon: FileDown, text: "Export tax-ready records in one click." },
];

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      {/* Brand panel - desktop only */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-primary p-10 text-primary-foreground lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-white/10 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-24 size-96 rounded-full bg-black/10 blur-3xl"
        />

        <Logo href="/" className="relative text-primary-foreground" />

        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">
            Turn receipts into tax-ready records.
          </h2>
          <p className="mt-3 text-primary-foreground/80">
            Expense tracking built for freelancers and sole traders - not accountants.
          </p>
          <ul className="mt-8 space-y-4">
            {FEATURES.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/15">
                  <Icon className="size-4" />
                </span>
                <span className="text-sm text-primary-foreground/90">{text}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-sm text-primary-foreground/60">
          © {new Date().getFullYear()} {BRAND}
        </p>
      </div>

      {/* Form column */}
      <div className="flex flex-col items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo href="/" />
          </div>
          {children}
          <p className="mt-8 text-center text-xs text-muted-foreground">
            <Link href="/terms" className="hover:text-foreground hover:underline">
              Terms
            </Link>
            {" · "}
            <Link href="/privacy" className="hover:text-foreground hover:underline">
              Privacy
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
