"use client";

import { useId, type InputHTMLAttributes } from "react";

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export function TextField({ label, error, id, className = "", ...props }: TextFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={fieldId} className="font-body text-sm text-neutral-900">
        {label}
      </label>
      <input
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fieldId}-error` : undefined}
        className={`rounded-md border px-3 py-2 font-body text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-primary ${
          error ? "border-danger" : "border-neutral-300"
        } ${className}`}
        {...props}
      />
      {error ? (
        <p id={`${fieldId}-error`} role="alert" className="font-body text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
