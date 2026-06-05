"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { House, LifeBuoy, Receipt, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "./logo";
import { UserMenu } from "./user-menu";

const NAV = [
  { label: "Home", href: "/home", icon: House },
  { label: "Transactions", href: "/transactions", icon: Receipt },
  { label: "Settings", href: "/settings", icon: Settings },
];

interface AppSidebarProps {
  name?: string;
  email?: string;
  onSupport: () => void;
}

function AppSidebar({ name, email, onSupport }: AppSidebarProps) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border bg-card lg:flex">
      <div className="flex h-16 items-center px-5">
        <Logo />
      </div>
      <nav className="flex-1 space-y-1 px-3 py-2">
        {NAV.map(({ label, href, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isActive(href)
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        ))}
        <button
          type="button"
          onClick={onSupport}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <LifeBuoy className="size-4" />
          Support
        </button>
      </nav>
      <div className="border-t border-border p-3">
        <UserMenu name={name} email={email} onSupport={onSupport} side="top" align="start" />
      </div>
    </aside>
  );
}

export { AppSidebar };
