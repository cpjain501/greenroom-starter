"use client";

// Client wrapper that owns the "which value wins when there's a conflict" state
// and re-runs calculateSettlement synchronously whenever a resolution is applied.
// The server component (settle/page.tsx) passes the initial input and detected
// conflicts; this component drives the rest client-side.

import { useMemo, useState } from "react";
import {
  calculateSettlement,
  type SettlementInput,
  type BonusEntry,
} from "@/lib/settlement/calculateSettlement";
import type { ConflictResult } from "@/lib/settlement/detectConflicts";
import { ConflictWarning } from "./ConflictWarning";
import { SettlementWaterfall } from "./SettlementWaterfall";

interface Props {
  input: SettlementInput;
  conflicts: ConflictResult[];
  artistName: string;
  showDate: string;
}

export function SettlementConflictResolver({
  input,
  conflicts,
  artistName,
  showDate,
}: Props) {
  const [currentInput, setCurrentInput] = useState<SettlementInput>(input);

  // Derived — recalculates whenever currentInput changes.
  const result = useMemo(
    () => calculateSettlement(currentInput),
    [currentInput],
  );

  function handleResolve(
    conflictId: string,
    chosenValue: string,
    _source: "structured" | "notes",
  ) {
    setCurrentInput((prev) => applyResolution(prev, conflictId, chosenValue));
  }

  return (
    <div className="space-y-4">
      <ConflictWarning conflicts={conflicts} onResolve={handleResolve} />
      <SettlementWaterfall
        result={result}
        artistName={artistName}
        showDate={showDate}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resolution applier — maps a conflictId + chosen value → updated input
// ---------------------------------------------------------------------------

function applyResolution(
  input: SettlementInput,
  conflictId: string,
  value: string,
): SettlementInput {
  switch (conflictId) {
    case "guarantee_mismatch":
      return { ...input, guarantee: parseFloat(value) };

    case "percentage_mismatch":
      return { ...input, percentage: parseFloat(value) };

    case "hospitality_cap_mismatch":
      return { ...input, hospitalityCap: parseFloat(value) };

    case "walkout_threshold_type": {
      if (value === "breakeven") {
        // User confirmed the notes are right — switch the bonus to use the
        // dynamically-calculated breakeven point instead of the stored threshold.
        const updatedBonuses: BonusEntry[] = input.bonusesJson.map((b) =>
          b.type === "walkout_pot"
            ? { ...b, thresholdType: "breakeven" as const }
            : b,
        );
        return { ...input, bonusesJson: updatedBonuses };
      }
      // User confirmed the fixed threshold — no change needed.
      return input;
    }

    default:
      return input;
  }
}
