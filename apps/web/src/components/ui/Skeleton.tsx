/**
 * A subtle loading placeholder, per the architecture doc's explicit
 * guidance: a skeleton state, never a blank screen, for anything async.
 * Respects prefers-reduced-motion automatically via the global rule in
 * globals.css (animation-duration forced to ~0 for that media query) —
 * nothing extra needed here.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded bg-neutral-300 ${className}`}
    />
  );
}
