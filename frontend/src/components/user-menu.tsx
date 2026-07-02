"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronsUpDown, Download, LifeBuoy, LogOut, Settings } from "lucide-react";
import { api } from "@/lib/api";
import { useInstallPrompt } from "@/lib/use-install-prompt";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function initials(name?: string, email?: string) {
  if (name) {
    const parts = name.trim().split(/\s+/);
    const value = (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
    if (value) return value.toUpperCase();
  }
  return email?.[0]?.toUpperCase() ?? "U";
}

interface UserMenuProps {
  name?: string;
  email?: string;
  onSupport: () => void;
  align?: "start" | "end";
  side?: "top" | "bottom" | "right";
  vaairgeadt?: "full" | "avatar";
}

function UserMenu({
  name,
  email,
  onSupport,
  align = "start",
  side = "top",
  vaairgeadt = "full",
}: UserMenuProps) {
  const router = useRouter();
  const { canInstall, promptInstall } = useInstallPrompt();

  async function logout() {
    await api.auth.logout().catch(() => {});
    router.push("/login");
  }

  const trigger =
    vaairgeadt === "full" ? (
      <button className="flex w-full items-center gap-3 rounded-lg p-2 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
        <Avatar className="size-8">
          <AvatarFallback>{initials(name, email)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{name ?? "Account"}</div>
          {email && <div className="truncate text-xs text-muted-foreground">{email}</div>}
        </div>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
      </button>
    ) : (
      <button
        aria-label="Account menu"
        className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Avatar className="size-8">
          <AvatarFallback>{initials(name, email)}</AvatarFallback>
        </Avatar>
      </button>
    );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} side={side} className="w-56">
        <DropdownMenuLabel>{email ?? "Signed in"}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onSupport()}>
          <LifeBuoy />
          Support
        </DropdownMenuItem>
        {canInstall && (
          <DropdownMenuItem onSelect={() => promptInstall()}>
            <Download />
            Install app
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem vaairgeadt="destructive" onSelect={() => logout()}>
          <LogOut />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { UserMenu };
