import clsx from "clsx";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

/**
 * Shared interaction states so every control feels the same: a hover tint, a
 * pressed nudge, and a keyboard-only focus ring. `focus-visible` rather than
 * `focus` keeps the ring off mouse clicks but present for tab navigation.
 */
const BASE = clsx(
  "inline-flex items-center justify-center gap-2 rounded-md font-medium",
  "cursor-pointer select-none whitespace-nowrap",
  "transition-[background-color,border-color,color,transform,box-shadow] duration-150 ease-out",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]",
  "active:translate-y-px",
  "disabled:pointer-events-none disabled:opacity-50",
  // aria-busy marks the in-flight state; pointer-events stay off so a second
  // click can't fire while the first request is still running.
  "aria-busy:pointer-events-none aria-busy:opacity-70",
);

const VARIANTS: Record<Variant, string> = {
  primary: clsx(
    "bg-[var(--accent)] text-white shadow-sm",
    "hover:bg-[var(--accent-hover)] hover:shadow",
    "active:bg-[var(--accent-active)] active:shadow-none",
  ),
  secondary: clsx(
    "border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]",
    "hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]",
    "active:bg-[var(--surface-active)]",
  ),
  ghost: clsx(
    "text-[var(--muted)]",
    "hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]",
    "active:bg-[var(--surface-active)]",
  ),
  danger: clsx(
    "border border-[var(--border)] bg-[var(--surface)] text-[var(--danger)]",
    "hover:border-[var(--danger)] hover:bg-[var(--danger-surface)]",
    "active:bg-[var(--danger-surface)]",
  ),
};

const SIZES: Record<Size, string> = {
  sm: "px-2.5 py-1.5 text-xs",
  md: "px-3.5 py-2 text-sm",
  lg: "px-6 py-3 text-base",
};

type Props = ComponentProps<"button"> & {
  variant?: Variant;
  size?: Size;
  /** Shows a spinner and blocks further clicks without changing the layout. */
  busy?: boolean;
  children: ReactNode;
};

export default function Button({
  variant = "secondary",
  size = "md",
  busy = false,
  className,
  children,
  disabled,
  ...rest
}: Props) {
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={clsx(BASE, VARIANTS[variant], SIZES[size], className)}
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
}

/** Anchors styled as buttons — used for downloads, which must stay real links. */
export function ButtonLink({
  variant = "secondary",
  size = "md",
  className,
  children,
  ...rest
}: ComponentProps<"a"> & { variant?: Variant; size?: Size }) {
  return (
    <a {...rest} className={clsx(BASE, VARIANTS[variant], SIZES[size], className)}>
      {children}
    </a>
  );
}

function Spinner() {
  return (
    <svg
      className="h-3.5 w-3.5 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}
