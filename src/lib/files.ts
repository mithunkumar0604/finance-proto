// Photos and scans of what is held as security. The rules here are plain checks the
// screens share; reading and saving is in ./data/remote. Files live in a private
// storage bucket as "<loan id>/<tile>-<time>.<ext>" and are only ever shown through
// short-lived signed links.

import type { Security } from "./types";

/** The storage bucket accepts nothing larger. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** A photo larger than this is not even tried: it is made smaller before sending, but there is a limit. */
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };
export const FILE_ACCEPT = Object.keys(EXT).join(",");

export interface FileSlot {
  /** Used in the file name: lower-case letters and digits only. */
  id: string;
  label: string;
}

const SLOTS: Record<"vehicle" | "jewel" | "document", FileSlot[]> = {
  vehicle: [{ id: "front", label: "Front" }, { id: "side", label: "Side" }, { id: "rc", label: "RC Book" }],
  jewel: [{ id: "item", label: "Item photo" }, { id: "weighing", label: "Weighing" }, { id: "packet", label: "Packet" }],
  document: [{ id: "page1", label: "Page 1" }, { id: "page2", label: "Page 2" }, { id: "receipt", label: "Receipt" }],
};

/** The three tiles shown for a kind of security. */
export const slotsFor = (kind: Security["kind"]): FileSlot[] => SLOTS[kind === "other" ? "document" : kind];

const BY_NAME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf" };

/** The kind of file. Some phone file pickers leave the type empty: then the name's ending decides. */
export function fileType(file: { type: string; name?: string }): string {
  return file.type || BY_NAME[(file.name ?? "").split(".").pop()!.toLowerCase()] || "";
}

/** What is wrong with a chosen file, in words for the user; null when it can be sent. */
export function fileProblem(file: { type: string; size: number; name?: string }): string | null {
  const type = fileType(file);
  if (!EXT[type]) return "Use a photo (JPG, PNG or WebP) or a PDF.";
  if (file.size <= 0) return "This file is empty.";
  if (type === "application/pdf") return file.size > MAX_FILE_BYTES ? "This PDF is larger than 5 MB. Scan it at a lower quality and try again." : null;
  return file.size > MAX_PHOTO_BYTES ? "This photo is too large. Take it again at a lower quality." : null;
}

export const isPdf = (name: string) => name.toLowerCase().endsWith(".pdf");

export function filePath(loanId: string, slot: string, type: string, now: number): string {
  return `${loanId}/${slot}-${now}.${EXT[type] ?? "jpg"}`;
}

/** From the file names in a loan's folder: the newest file of each tile. */
export function latestPerSlot(names: string[]): Record<string, string> {
  const best: Record<string, { at: number; name: string }> = {};
  for (const name of names) {
    const m = /^([a-z0-9]+)-(\d+)\.[a-z0-9]+$/.exec(name);
    if (!m) continue;
    const at = Number(m[2]);
    if (!best[m[1]] || at > best[m[1]].at) best[m[1]] = { at, name };
  }
  return Object.fromEntries(Object.entries(best).map(([slot, b]) => [slot, b.name]));
}
