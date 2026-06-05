"use client";

import { Toaster as SonnerToaster } from "sonner";

/** App-wide toast portal. Use `import { toast } from "sonner"` to fire toasts. */
function Toaster() {
  return (
    <SonnerToaster
      position="top-center"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast:
            "rounded-lg border border-border bg-popover text-popover-foreground shadow-lg",
        },
      }}
    />
  );
}

export { Toaster };
