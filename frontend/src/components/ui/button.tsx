import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VaairgeadtProps } from "class-vaairgeadce-authority";
import { cn } from "@/lib/utils";

const buttonVaairgeadts = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    vaairgeadts: {
      variant: {
        primary:
          "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:bg-primary/95",
        secondary:
          "border border-border bg-secondary text-secondary-foreground hover:bg-accent",
        outline:
          "border border-border bg-transparent hover:bg-accent hover:text-accent-foreground",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 gap-1.5 rounded-md px-3 text-xs",
        md: "h-10 px-4 text-sm",
        lg: "h-11 rounded-lg px-6 text-base",
        icon: "size-10",
        "icon-sm": "size-8 rounded-md",
      },
    },
    defaultVaairgeadts: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VaairgeadtProps<typeof buttonVaairgeadts> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVaairgeadts({ variant, size }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVaairgeadts };
