"use client";

import { ExternalLink, FileText, Image as ImageIcon, LoaderCircle, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { listLoanFiles, loanFilePaths, removeLoanFiles, uploadLoanFile, type LoanFile } from "@/lib/data/remote";
import { FILE_ACCEPT, slotsFor, type FileSlot } from "@/lib/files";
import type { Security } from "@/lib/types";
import { errorText } from "@/lib/use-save";

const TILE = "relative flex aspect-[4/3] w-full flex-col items-center justify-center gap-1 overflow-hidden rounded-2xl bg-line-2 text-xs text-muted";

/**
 * LIVE: the three photo tiles of a security, backed by private storage. An empty tile
 * adds a file (owner and staff); a filled one opens it, where the owner can also replace
 * or remove it. Files are shown through signed links only.
 */
export function SecurityFiles({ loanId, kind, canAdd, canRemove }: { loanId: string; kind: Security["kind"]; canAdd: boolean; canRemove: boolean }) {
  const slots = slotsFor(kind);
  // null until the first read: a tile is not offered as empty before it is known to be
  const [files, setFiles] = useState<Record<string, LoanFile> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<FileSlot | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const target = useRef<FileSlot | null>(null);

  const read = async () => Object.fromEntries((await listLoanFiles(loanId)).map((f) => [f.slot, f]));

  useEffect(() => {
    let alive = true;
    listLoanFiles(loanId)
      .then((list) => alive && setFiles(Object.fromEntries(list.map((f) => [f.slot, f]))))
      .catch((e) => toast(errorText(e), "error"));
    return () => {
      alive = false;
    };
  }, [loanId]);

  const close = () => {
    setOpen(null);
    setConfirmRemove(false);
  };

  const pick = (slot: FileSlot) => {
    if (busy) return; // one file at a time
    target.current = slot;
    input.current?.click();
  };

  const save = async (file: File) => {
    const slot = target.current;
    if (!slot || busy || !files) return;
    const replacing = !!files[slot.id];
    close();
    setBusy(slot.id);
    try {
      // the older file of this tile is removed once the new one is safely saved
      const old = replacing && canRemove ? await loanFilePaths(loanId, slot.id) : [];
      await uploadLoanFile(loanId, slot.id, file);
      if (old.length) await removeLoanFiles(old).catch(() => {});
      setFiles(await read());
      toast(replacing ? `${slot.label} replaced` : `${slot.label} saved`);
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (slot: FileSlot) => {
    if (busy) return;
    close();
    setBusy(slot.id);
    try {
      await removeLoanFiles(await loanFilePaths(loanId, slot.id));
      setFiles(await read());
      toast(`${slot.label} removed`);
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(null);
    }
  };

  const shown = open ? files?.[open.id] : undefined;

  // signed links stop working after an hour: get fresh ones whenever a file is opened
  const show = (slot: FileSlot) => {
    setOpen(slot);
    read().then(setFiles, () => {});
  };

  return (
    <>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {slots.map((slot) => {
          const file = files?.[slot.id];
          if (busy === slot.id)
            return (
              <div key={slot.id} className={TILE} role="status">
                <LoaderCircle className="size-5 animate-spin" />
                Saving…
              </div>
            );
          if (file)
            return (
              <button key={slot.id} type="button" onClick={() => show(slot)} aria-label={`Open ${slot.label}`} className={TILE}>
                {file.pdf ? (
                  <FileText className="size-6 text-ink-2" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- a signed link to private storage; nothing to optimise at build time
                  <img src={file.url} alt="" className="absolute inset-0 size-full object-cover" />
                )}
                <span className={file.pdf ? "font-medium text-ink-2" : "absolute inset-x-0 bottom-0 truncate bg-black/55 px-1 py-0.5 text-center text-[11px] font-medium text-white"}>{slot.label}</span>
              </button>
            );
          if (canAdd && files)
            return (
              <button key={slot.id} type="button" onClick={() => pick(slot)} aria-label={`Add ${slot.label}`} className={`${TILE} transition hover:bg-line`}>
                <ImageIcon className="size-5 opacity-60" />
                {slot.label}
              </button>
            );
          return (
            <div key={slot.id} className={TILE}>
              <ImageIcon className="size-5 opacity-60" />
              {slot.label}
            </div>
          );
        })}
      </div>

      <input
        ref={input}
        type="file"
        accept={FILE_ACCEPT}
        className="hidden"
        data-testid="security-file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ""; // choosing the same file again must work
          if (file) void save(file);
        }}
      />

      {open && shown && (
        <Sheet
          open
          onClose={close}
          title={open.label}
          footer={
            confirmRemove ? (
              <div className="grid grid-cols-2 gap-2.5">
                <Button size="lg" variant="secondary" onClick={() => setConfirmRemove(false)}>
                  Keep
                </Button>
                <Button size="lg" variant="danger" onClick={() => void remove(open)}>
                  Yes, Remove
                </Button>
              </div>
            ) : (
              <div className={canRemove ? "grid grid-cols-3 gap-2.5" : "grid"}>
                <a href={shown.url} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "lg")}>
                  <ExternalLink className="size-4" /> Open
                </a>
                {canRemove && (
                  <>
                    <Button size="lg" variant="secondary" onClick={() => pick(open)}>
                      <RefreshCw className="size-4" /> Replace
                    </Button>
                    <Button size="lg" variant="danger" onClick={() => setConfirmRemove(true)}>
                      <Trash2 className="size-4" /> Remove
                    </Button>
                  </>
                )}
              </div>
            )
          }
        >
          {confirmRemove ? (
            <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900">Remove this file? It cannot be brought back.</p>
          ) : shown.pdf ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl bg-line-2 py-10 text-sm text-muted">
              <FileText className="size-8 text-ink-2" />
              PDF document. Tap Open to read it.
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- see above
            <img src={shown.url} alt={open.label} className="mx-auto max-h-[60dvh] w-auto rounded-2xl" />
          )}
        </Sheet>
      )}
    </>
  );
}
