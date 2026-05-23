"use client";

// Client island for the settlement waterfall + conflict resolution UI.
//
// The server component (settle/page.tsx) pre-computes TWO settlement results:
//   resultWithStructured — bonuses exactly as stored in the DB
//   resultWithNotes      — walkout_pot thresholdType changed to 'breakeven'
//
// This component holds a resolutions map { [conflictId]: 'structured' | 'notes' }
// and switches between the two pre-computed results accordingly. When any conflict
// is resolved to 'notes', the notes result is displayed; otherwise the structured
// result is shown. No client-side recalculation needed.

import { useState } from "react";
import { Check } from "lucide-react";
import type { SettlementResult } from "@/lib/settlement/calculateSettlement";
import type { ConflictResult } from "@/lib/settlement/detectConflicts";
import { ConflictWarning } from "./ConflictWarning";
import { SettlementWaterfall } from "./SettlementWaterfall";

interface Props {
  resultWithStructured: SettlementResult;
  resultWithNotes: SettlementResult;
  conflicts: ConflictResult[];
  artistName: string;
  showDate: string;
}

export function SettlementEngine({
  resultWithStructured,
  resultWithNotes,
  conflicts,
  artistName,
  showDate,
}: Props) {
  // Resolution state — defaults to 'structured' (unresolved = no key present)
  const [resolutions, setResolutions] = useState<
    Record<string, "structured" | "notes">
  >({});

  function handleResolve(conflictId: string, source: "structured" | "notes") {
    setResolutions((prev) => ({ ...prev, [conflictId]: source }));
  }

  // All-resolved: every detected conflict has an explicit choice
  const allResolved =
    conflicts.length > 0 &&
    conflicts.every((c) => resolutions[c.id] !== undefined);

  // Switch to the notes-derived result the moment any conflict goes to 'notes'
  const useNotes = Object.values(resolutions).some((v) => v === "notes");
  const activeResult = useNotes ? resultWithNotes : resultWithStructured;

  return (
    <div className="space-y-4">
      <ConflictWarning
        conflicts={conflicts}
        resolutions={resolutions}
        onResolve={handleResolve}
      />

      {allResolved && (
        <div className="flex items-center gap-2.5 rounded-lg bg-brand-50 px-4 py-3 ring-1 ring-brand-200/60">
          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-700">
            <Check className="h-3 w-3 text-white" />
          </div>
          <span className="text-[13px] font-medium text-brand-900">
            All conflicts resolved — waterfall updated
          </span>
        </div>
      )}

      <SettlementWaterfall
        result={activeResult}
        artistName={artistName}
        showDate={showDate}
      />
    </div>
  );
}
