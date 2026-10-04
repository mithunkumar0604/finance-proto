"use client";

import { useEffect, useRef, useState } from "react";
import { money, moneyShort } from "@/lib/format";

/** Amount (in paise) that counts smoothly to its new value when it changes. */
export function AnimatedMoney({ value, short, className }: { value: number; short?: boolean; className?: string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 650);
      const eased = 1 - Math.pow(1 - p, 3);
      // Whole rupees while counting, the exact amount at the end.
      setShown(p < 1 ? Math.round((start + (value - start) * eased) / 100) * 100 : value);
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      from.current = value;
    };
  }, [value]);

  return <span className={className}>{short ? moneyShort(shown) : money(shown)}</span>;
}
