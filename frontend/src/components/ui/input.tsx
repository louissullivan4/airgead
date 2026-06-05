import * as React from "react";
import { cn } from "@/lib/utils";

// text-base on mobile (16px) avoids iOS focus-zoom; text-sm from md up.
const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = "text", ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base shadow-sm transition-colors md:text-sm",
        "placeholder:text-muted-foreground",
        "focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "file:border-0 file:bg-transparent file:text-sm file:font-medium",
        "aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-destructive/30",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export { Input };
