"use client";

import { clsx } from "clsx";
import { useState, type ComponentProps, type ReactNode } from "react";

/** Labelled form row. Use `group` when the content is a set of buttons, so taps on the label don't trigger the first button. */
export function Field({ label, hint, required, children, className, group }: { label: string; hint?: ReactNode; required?: boolean; children: ReactNode; className?: string; group?: boolean }) {
  const Tag = group ? "div" : "label";
  return (
    <Tag className={clsx("block", className)}>
      <span className="mb-1.5 block text-sm font-semibold text-ink-2">
        {label}
        {required && <span className="text-rose-600"> *</span>}
      </span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-muted">{hint}</span>}
    </Tag>
  );
}

const inputBase =
  "w-full rounded-2xl border border-line bg-surface px-4 text-[16px] text-ink placeholder:text-faint outline-none transition focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={clsx(inputBase, "h-13", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={clsx(inputBase, "min-h-24 py-3", className)} {...props} />;
}

/** Rupee input: digits only, formatted with Indian grouping while typing. */
export function MoneyInput({
  value,
  onChange,
  size = "md",
  className,
  autoFocus,
  placeholder = "0",
  id,
}: {
  value: number | "";
  onChange: (v: number | "") => void;
  size?: "md" | "xl";
  className?: string;
  autoFocus?: boolean;
  placeholder?: string;
  id?: string;
}) {
  const display = value === "" ? "" : new Intl.NumberFormat("en-IN").format(value);
  return (
    <div
      className={clsx(
        "flex items-center rounded-2xl border border-line bg-surface px-4 transition focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-500/10",
        size === "xl" ? "h-18" : "h-13",
        className,
      )}
    >
      <span className={clsx("mr-1.5 font-semibold text-muted", size === "xl" ? "text-3xl" : "text-lg")}>₹</span>
      <input
        id={id}
        inputMode="numeric"
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={display}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
          onChange(digits === "" ? "" : Number(digits));
        }}
        className={clsx(
          "num w-full min-w-0 bg-transparent font-bold text-ink outline-none placeholder:text-faint",
          size === "xl" ? "text-[34px] tracking-tight" : "text-lg",
        )}
      />
    </div>
  );
}

/** Large tappable option cards (loan type, security, etc). */
export function OptionGrid<T extends string>({
  options,
  value,
  onChange,
  cols = 2,
}: {
  options: { value: T; label: string; sub?: string; icon?: ReactNode }[];
  value: T | undefined;
  onChange: (v: T) => void;
  cols?: 2 | 3 | 4;
}) {
  return (
    <div className={clsx("grid gap-2.5", { 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-2 sm:grid-cols-4" }[cols])}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={clsx(
              "flex min-h-14 flex-col items-start justify-center gap-1 rounded-2xl border p-3.5 text-left transition active:scale-[0.98]",
              on ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600" : "border-line bg-surface hover:border-faint",
            )}
          >
            {o.icon && <span className={clsx("mb-1", on ? "text-brand-700" : "text-muted")}>{o.icon}</span>}
            <span className={clsx("text-[15px] font-semibold", on ? "text-brand-800" : "text-ink")}>{o.label}</span>
            {o.sub && <span className="text-xs text-muted">{o.sub}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Compact pill selector for short choices (payment method etc). */
export function PillSelect<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; icon?: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={clsx(
            "flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 text-sm font-semibold transition",
            value === o.value ? "border-brand-600 bg-brand-50 text-brand-800 ring-1 ring-brand-600" : "border-line bg-surface text-ink-2",
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PhotoPlaceholder({ label = "Add photo", className }: { label?: string; className?: string }) {
  return (
    <button
      type="button"
      className={clsx(
        "flex h-24 w-full flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-line text-sm font-medium text-muted transition hover:border-brand-200 hover:bg-brand-50/50",
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
        <circle cx="12" cy="13" r="3.5" />
      </svg>
      {label}
    </button>
  );
}

/** Decimal number input (e.g. 2.5%). Keeps the typed text so "2." is not swallowed. */
export function DecimalInput({ value, onChange, suffix, placeholder }: { value: number; onChange: (v: number) => void; suffix?: string; placeholder?: string }) {
  const [text, setText] = useState(value ? String(value) : "");
  return (
    <div className="flex h-13 items-center rounded-2xl border border-line bg-surface px-4 focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-500/10">
      <input
        inputMode="decimal"
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
          setText(t);
          onChange(parseFloat(t) || 0);
        }}
        className="num w-full bg-transparent text-lg font-bold outline-none placeholder:text-faint"
      />
      {suffix && <span className="text-lg font-semibold text-muted">{suffix}</span>}
    </div>
  );
}
