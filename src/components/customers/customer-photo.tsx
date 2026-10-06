"use client";

import { Camera, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/bits";
import { toast } from "@/components/ui/toast";
import { listLoanFiles, loanFilePaths, removeLoanFiles, uploadLoanFile } from "@/lib/data/remote";
import { CUSTOMER_SLOTS, fileProblem } from "@/lib/files";
import { errorText } from "@/lib/use-save";

const PHOTO = CUSTOMER_SLOTS[0];

/**
 * LIVE: the round picture beside a customer's name. Shows the customer's photo when there
 * is one (the same file as the "Customer photo" tile on the Docs tab), otherwise the
 * initials. The small camera button adds a photo, or changes it (owner only; staff can
 * add one where there is none).
 */
export function CustomerPhoto({ customerId, name, canAdd, canReplace, onChanged }: { customerId: string; name: string; canAdd: boolean; canReplace: boolean; onChanged?: () => void }) {
  // undefined = not read yet, null = no photo
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const read = async () => (await listLoanFiles(customerId)).find((f) => f.slot === PHOTO.id && !f.pdf)?.url ?? null;

  useEffect(() => {
    let alive = true;
    listLoanFiles(customerId)
      .then((list) => alive && setUrl(list.find((f) => f.slot === PHOTO.id && !f.pdf)?.url ?? null))
      .catch(() => alive && setUrl(null)); // the initials are shown; the Docs tab reports a reading problem
    return () => {
      alive = false;
    };
  }, [customerId]);

  const save = async (file: File) => {
    if (busy) return;
    const problem = fileProblem(file);
    if (problem) return toast(problem, "error");
    if (file.type === "application/pdf") return toast("Choose a photo for the customer's picture.", "error");
    const had = !!url;
    setBusy(true);
    try {
      // the older photo is removed once the new one is safely saved
      const old = canReplace ? await loanFilePaths(customerId, PHOTO.id) : [];
      await uploadLoanFile(customerId, PHOTO.id, file);
      if (old.length) await removeLoanFiles(old).catch(() => {});
      setUrl(await read());
      toast(had ? "Photo changed" : "Photo saved");
      onChanged?.();
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const canChange = url !== undefined && (canReplace || (canAdd && !url));

  return (
    <span className="relative shrink-0">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- a signed link to private storage; nothing to optimise at build time
        <img src={url} alt={`Photo of ${name}`} className="size-18 rounded-full object-cover" />
      ) : (
        <Avatar name={name} size="xl" />
      )}
      {busy && (
        <span className="absolute inset-0 grid place-items-center rounded-full bg-black/45 text-white" role="status" aria-label="Saving photo">
          <LoaderCircle className="size-6 animate-spin" />
        </span>
      )}
      {canChange && !busy && (
        <>
          <button
            type="button"
            onClick={() => input.current?.click()}
            aria-label={url ? "Change photo" : "Add photo"}
            className="absolute -right-1 -bottom-1 grid size-8 place-items-center rounded-full border-2 border-surface bg-brand-700 text-white shadow-sm"
          >
            <Camera className="size-4" />
          </button>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void save(file);
            }}
          />
        </>
      )}
    </span>
  );
}
