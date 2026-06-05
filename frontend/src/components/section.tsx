import * as React from "react";
import { cn } from "@/lib/utils";

interface SectionProps {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

function Section({ title, description, action, children, className }: SectionProps) {
  return (
    <section className={cn("space-y-3", className)}>
      {(title || action) && (
        <div className="flex items-end justify-between gap-2">
          <div className="space-y-0.5">
            {title && <h2 className="text-base font-semibold tracking-tight">{title}</h2>}
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export { Section };
