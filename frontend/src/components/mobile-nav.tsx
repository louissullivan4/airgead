"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { House, LifeBuoy, Plus, Receipt, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "./logo";
import { UserMenu } from "./user-menu";

interface MobileChromeProps {
  name?: string;
  email?: string;
  onSupport: () => void;
}

function MobileTopBar({ name, email, onSupport }: MobileChromeProps) {
  return (
    <header
      className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur lg:hidden"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <Logo />
      <UserMenu
        name={name}
        email={email}
        onSupport={onSupport}
        variant="avatar"
        side="bottom"
        align="end"
      />
    </header>
  );
}

function MobileBottomNav({ onSupport }: { onSupport: () => void }) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const tab = (href: string, label: string, Icon: LucideIcon) => (
    <Link
      href={href}
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-0.5 text-[0.6875rem] font-medium transition-colors",
        isActive(href) ? "text-primary" : "text-muted-foreground",
      )}
    >
      <Icon className="size-5" />
      {label}
    </Link>
  );

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/90 backdrop-blur lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex h-16 items-stretch">
        {tab("/home", "Home", House)}
        {tab("/transactions", "Activity", Receipt)}
        <div className="flex flex-1 items-center justify-center">
          <Link
            href="/transactions?add=1"
            aria-label="Add transaction"
            className="flex size-12 -translate-y-3 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 ring-4 ring-background transition-transform active:scale-95"
          >
            <Plus className="size-6" />
          </Link>
        </div>
        {tab("/settings", "Settings", Settings)}
        <button
          type="button"
          onClick={onSupport}
          className="flex flex-1 flex-col items-center justify-center gap-0.5 text-[0.6875rem] font-medium text-muted-foreground"
        >
          <LifeBuoy className="size-5" />
          Support
        </button>
      </div>
    </nav>
  );
}

export { MobileTopBar, MobileBottomNav };
