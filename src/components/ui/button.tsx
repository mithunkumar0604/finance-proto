import Link from "next/link";
import { clsx } from "clsx";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "soft";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-2xl font-semibold transition-[background,transform,box-shadow] active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none select-none whitespace-nowrap";

const variants: Record<Variant, string> = {
  primary: "bg-brand-700 text-white shadow-[0_1px_0_rgba(255,255,255,.15)_inset,0_6px_16px_-6px_rgba(11,90,71,.55)] hover:bg-brand-800",
  secondary: "bg-surface text-ink border border-line hover:bg-line-2",
  soft: "bg-brand-50 text-brand-800 hover:bg-brand-100",
  ghost: "text-ink-2 hover:bg-line-2",
  danger: "bg-rose-50 text-rose-700 border border-rose-100 hover:bg-rose-100",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-3.5 text-sm rounded-xl",
  md: "h-11 px-4 text-[15px]",
  lg: "h-14 px-6 text-base",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", extra?: string) {
  return clsx(base, variants[variant], sizes[size], extra);
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button type="button" className={buttonClass(variant, size, className)} {...props} />;
}

export function LinkButton({
  href,
  variant = "primary",
  size = "md",
  className,
  children,
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)}>
      {children}
    </Link>
  );
}

export function IconButton({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={clsx(
        "grid size-11 shrink-0 place-items-center rounded-full text-ink-2 transition hover:bg-line-2 active:scale-95",
        className,
      )}
      {...props}
    />
  );
}
