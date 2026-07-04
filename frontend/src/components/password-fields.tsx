"use client";

import { useState } from "react";
import { Check, Eye, EyeOff, X } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

// Password strength rules, shown as a live checklist under the field. The
// register and reset endpoints enforce the same rules server-side (client
// checks alone are bypassable via a direct API call).
export const PASSWORD_RULES: { label: string; test: (pw: string) => boolean }[] = [
  { label: "At least 8 characters", test: (pw) => pw.length >= 8 },
  { label: "One lowercase letter", test: (pw) => /[a-z]/.test(pw) },
  { label: "One uppercase letter", test: (pw) => /[A-Z]/.test(pw) },
  { label: "One number", test: (pw) => /[0-9]/.test(pw) },
  { label: "One symbol", test: (pw) => /[^A-Za-z0-9]/.test(pw) },
];

export const passwordMeetsRules = (password: string) =>
  PASSWORD_RULES.every((rule) => rule.test(password));

function RevealToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={shown ? "Hide password" : "Show password"}
      className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground transition-colors hover:text-foreground"
    >
      {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
    </button>
  );
}

/**
 * Password + retype fields with reveal toggles, a live rules checklist and an
 * inline mismatch error. Shared by signup (both variants) and reset-password
 * so the password UX stays identical everywhere.
 */
export function PasswordFields({
  password,
  confirmPassword,
  onPasswordChange,
  onConfirmPasswordChange,
}: {
  password: string;
  confirmPassword: string;
  onPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;

  return (
    <>
      <Field label="Password" htmlFor="password">
        <div className="relative">
          <Input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            className="pr-10"
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            required
          />
          <RevealToggle shown={showPassword} onToggle={() => setShowPassword((v) => !v)} />
        </div>
        <ul className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2" aria-live="polite">
          {PASSWORD_RULES.map((rule) => {
            const met = rule.test(password);
            return (
              <li
                key={rule.label}
                className={`flex items-center gap-1.5 text-xs ${
                  met ? "text-primary" : "text-muted-foreground"
                }`}
              >
                {met ? <Check className="size-3 shrink-0" /> : <X className="size-3 shrink-0" />}
                {rule.label}
              </li>
            );
          })}
        </ul>
      </Field>
      <Field
        label="Retype password"
        htmlFor="confirm-password"
        error={mismatch ? "Passwords do not match." : undefined}
      >
        <div className="relative">
          <Input
            id="confirm-password"
            type={showConfirm ? "text" : "password"}
            autoComplete="new-password"
            className="pr-10"
            value={confirmPassword}
            onChange={(e) => onConfirmPasswordChange(e.target.value)}
            aria-invalid={mismatch || undefined}
            required
          />
          <RevealToggle shown={showConfirm} onToggle={() => setShowConfirm((v) => !v)} />
        </div>
      </Field>
    </>
  );
}
