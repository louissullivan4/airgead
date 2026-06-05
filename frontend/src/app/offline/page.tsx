import type { Metadata } from "next";
import Link from "next/link";
import { WifiOff } from "lucide-react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-5 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
        <WifiOff className="size-6 text-muted-foreground" />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">You&apos;re offline</h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        rian needs a connection to load your transactions. Check your network and try again.
      </p>
      <Button asChild className="mt-6">
        <Link href="/home">Try again</Link>
      </Button>
      <div className="mt-10">
        <Logo href="/home" />
      </div>
    </div>
  );
}
