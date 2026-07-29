"use client";

import { useId, type SelectHTMLAttributes } from "react";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
}

export function Select({ label, error, id, className = "", children, ...props }: SelectProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={fieldId} className="font-body text-sm text-neutral-900">
        {label}
      </label>
      <select
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fieldId}-error` : undefined}
        className={`rounded-md border bg-white px-3 py-2 font-body text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-primary ${
          error ? "border-danger" : "border-neutral-300"
        } ${className}`}
        {...props}
      >
        {children}
      </select>
      {error ? (
        <p id={`${fieldId}-error`} role="alert" className="font-body text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
