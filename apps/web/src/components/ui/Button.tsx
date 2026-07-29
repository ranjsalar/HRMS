"use client";

import type { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Immediate visual feedback for an in-flight async action — disables the button and swaps in a spinner, per the architecture doc's loading-state guidance. */
  loading?: boolean;
  variant?: "primary" | "secondary";
}

const VARIANTS: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "bg-primary text-white hover:bg-primary-dark",
  secondary: "border border-neutral-300 text-neutral-900 hover:bg-neutral-100",
};

export function Button({
  loading = false,
  variant = "primary",
  disabled,
  children,
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 font-body text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${VARIANTS[variant]} ${className}`}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : null}
      {children}
    </button>
  );
}
