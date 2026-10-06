"use client";

import { Image as ImageIcon } from "lucide-react";
import { SecurityIcon } from "@/components/loans/loan-card";
import { FileTiles } from "@/components/security/security-files";
import { Chip, Row } from "@/components/ui/bits";
import { slotsFor } from "@/lib/files";
import { money } from "@/lib/format";
import type { Security } from "@/lib/types";

const VEHICLE_TYPE = { car: "Car", bike: "Bike", commercial: "Commercial", other: "Other" };

export function securityTitle(sec: Security) {
  return sec.kind === "vehicle" ? "Vehicle Security" : sec.kind === "jewel" ? "Gold Jewellery" : sec.kind === "document" ? "Document Security" : "Other Security";
}

/** `files` (LIVE): the loan whose photos are shown in the tiles, and what this person may do with them. */
export function SecurityDetails({ sec, files }: { sec: Security; files?: { loanId: string; canAdd: boolean; canRemove: boolean } }) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <span className="grid size-12 place-items-center rounded-2xl bg-amber-50 text-[#8a6418]">
          <SecurityIcon sec={sec} className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-muted">{securityTitle(sec)}</p>
          <p className="truncate text-lg font-extrabold tracking-tight">
            {sec.kind === "vehicle" ? sec.registration : sec.kind === "jewel" ? sec.description : sec.kind === "document" ? sec.documentType : sec.description}
          </p>
        </div>
        <Chip tone={sec.status === "held" ? "gold" : "slate"} dot>
          {sec.status === "held" ? "HELD" : "RELEASED"}
        </Chip>
      </div>

      <div className="mt-3 divide-y divide-line-2">
        {sec.kind === "vehicle" && (
          <>
            <Row label="Vehicle Type" value={VEHICLE_TYPE[sec.vehicleType]} />
            <Row label="Make / Model" value={`${sec.make} ${sec.model}`} />
            <Row label="Owner Name" value={sec.ownerName} />
            <Row label="RC Reference" value={sec.rcRef} />
            <Row label="Document Held" value={sec.documentHeld} />
            <Row label="Storage" value={sec.storage} />
          </>
        )}
        {sec.kind === "jewel" && (
          <>
            <Row label="Weight" value={`${sec.weightGrams} g`} />
            <Row label="Purity" value={sec.purity} />
            <Row label="Estimated Value" value={money(sec.estimatedValue)} />
            <Row label="Packet No." value={sec.packetNo} />
            <Row label="Storage" value={sec.storage} />
            {sec.notes && <Row label="Notes" value={sec.notes} />}
          </>
        )}
        {sec.kind === "document" && (
          <>
            <Row label="Owner" value={sec.owner} />
            <Row label="Reference No." value={sec.referenceNo} />
            <Row label="Original / Copy" value={sec.original ? "Original" : "Copy"} />
            <Row label="Description" value={sec.description} />
            <Row label="Storage" value={sec.storage} />
          </>
        )}
        {sec.kind === "other" && <Row label="Storage" value={sec.storage} />}
      </div>

      {files ? (
        <FileTiles key={files.loanId} folder={files.loanId} slots={slotsFor(sec.kind)} canAdd={files.canAdd} canRemove={files.canRemove} />
      ) : (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {slotsFor(sec.kind).map((t) => (
            <div key={t.id} className="flex aspect-[4/3] flex-col items-center justify-center gap-1 rounded-2xl bg-line-2 text-xs text-muted">
              <ImageIcon className="size-5 opacity-60" />
              {t.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
