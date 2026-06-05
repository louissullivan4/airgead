import * as React from "react";
import { Label } from "./label";
import { cn } from "@/lib/utils";

interface FieldProps {
  label?: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}

/** Label + control + hint/error in a consistent vertical stack. */
function Field({ label, htmlFor, hint, error, required, className, children }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <Label htmlFor={htmlFor}>
          {label}
          {required && <span className="text-destructive"> *</span>}
        </Label>
      )}
      {children}
      {error ? (
        <p className="text-xs font-medium text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export { Field };
