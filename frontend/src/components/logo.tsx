import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

interface LogoProps {
  href?: string;
  className?: string;
  /** Hide the wordmark, show the mark only. */
  iconOnly?: boolean;
}

function Logo({ href = "/home", className, iconOnly = false }: LogoProps) {
  return (
    <Link href={href} className={cn("flex items-center gap-2 text-foreground", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/icon.svg" alt="" aria-hidden className="size-7 rounded-[0.5rem]" />
      {!iconOnly && (
        <span className="text-lg font-semibold tracking-tight">{BRAND}</span>
      )}
    </Link>
  );
}

export { Logo };
