"use client";

import { Check, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ConflictResult } from "@/lib/settlement/detectConflicts";

// Controlled component — the parent (SettlementEngine) owns resolution state.
// ConflictWarning renders resolved/unresolved rows based on the resolutions map
// it receives. Clicking a button calls onResolve(conflictId, source) so the
// parent can update its state and switch the active waterfall result.

interface Props {
  conflicts: ConflictResult[];
  resolutions: Record<string, "structured" | "notes">;
  onResolve: (conflictId: string, source: "structured" | "notes") => void;
}

export function ConflictWarning({ conflicts, resolutions, onResolve }: Props) {
  if (conflicts.length === 0) return null;

  const resolvedCount = Object.keys(resolutions).length;

  return (
    <Card accent="amber" className="bg-amber-50/20">
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-50 ring-1 ring-amber-200/80 mt-0.5">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-700" />
          </div>
          <div>
            <div className="text-[13px] font-semibold text-ink-900">
              {conflicts.length} deal term conflict
              {conflicts.length === 1 ? "" : "s"} detected
              {resolvedCount > 0 && (
                <span className="ml-2 text-[11.5px] font-normal text-ink-400">
                  {resolvedCount} of {conflicts.length} resolved
                </span>
              )}
            </div>
            <p className="text-[12px] text-ink-500 mt-0.5 leading-relaxed">
              These differences between the structured fields and deal notes
              affect the calculation. Confirm which to use.
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-5 py-0 divide-y divide-amber-100/80">
        {conflicts.map((conflict) => {
          const source = resolutions[conflict.id];

          if (source !== undefined) {
            return (
              <ResolvedRow
                key={conflict.id}
                conflict={conflict}
                source={source}
              />
            );
          }

          return (
            <ConflictRow
              key={conflict.id}
              conflict={conflict}
              onResolve={onResolve}
            />
          );
        })}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Resolved state — collapsed single line with checkmark
// ---------------------------------------------------------------------------

function ResolvedRow({
  conflict,
  source,
}: {
  conflict: ConflictResult;
  source: "structured" | "notes";
}) {
  const label =
    conflict.resolutionOptions.find((o) => o.source === source)?.label ??
    source;
  const isDismiss = conflict.dismissOnly;

  return (
    <div className="py-3 flex items-center gap-2 min-w-0 overflow-hidden">
      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 ring-1 ring-brand-200/60">
        <Check className="h-3 w-3 text-brand-700" />
      </div>
      <span className="text-[12.5px] font-medium text-ink-700 shrink-0">
        {conflict.field}
      </span>
      {isDismiss ? (
        <span className="text-[12px] text-ink-400 shrink-0">— noted</span>
      ) : (
        <>
          <span className="text-[12px] text-ink-400 shrink-0">→ using</span>
          <span
            className="text-[12.5px] font-mono text-ink-800 truncate min-w-0"
            title={label}
          >
            {label}
          </span>
          <span className="inline-flex items-center px-1.5 py-px rounded text-[9.5px] font-medium bg-ink-100 text-ink-500 ring-1 ring-inset ring-ink-200/60 shrink-0">
            {source === "structured" ? "structured" : "notes"}
          </span>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unresolved conflict — full expanded display
// ---------------------------------------------------------------------------

function ConflictRow({
  conflict,
  onResolve,
}: {
  conflict: ConflictResult;
  onResolve: (conflictId: string, source: "structured" | "notes") => void;
}) {
  return (
    <div
      className={cn(
        "py-4",
        conflict.severity === "high" &&
          "border-l-2 border-rose-300 pl-4 -ml-5",
      )}
    >
      {/* Field name + severity badge */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[13px] font-semibold text-ink-900">
          {conflict.field}
        </span>
        {conflict.severity === "high" ? (
          <span className="inline-flex items-center px-1.5 py-px rounded text-[9px] font-mono uppercase tracking-wider bg-rose-50 ring-1 ring-rose-200/60 text-rose-700">
            high
          </span>
        ) : (
          <span className="inline-flex items-center px-1.5 py-px rounded text-[9px] font-mono uppercase tracking-wider bg-amber-50 ring-1 ring-amber-200/60 text-amber-700">
            medium
          </span>
        )}
      </div>

      {/* Structured vs notes comparison */}
      <div className="grid grid-cols-2 gap-3 mb-3 p-3 rounded-lg bg-white/60 ring-1 ring-amber-200/40">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-400 mb-1">
            Structured fields say
          </div>
          <div className="text-[13px] font-mono text-ink-800">
            {conflict.structuredValue}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-400 mb-1">
            Deal notes say
          </div>
          <div className="text-[13px] font-mono text-ink-800">
            {conflict.notesValue}
          </div>
        </div>
      </div>

      {/* Description */}
      <p className="text-[12px] text-ink-500 leading-relaxed mb-3">
        {conflict.description}
      </p>

      {/* Dollar impact */}
      {conflict.estimatedDollarImpact != null &&
        conflict.estimatedDollarImpact > 0 && (
          <div className="text-[12px] font-medium text-rose-700 mb-3">
            ~$
            {conflict.estimatedDollarImpact.toLocaleString("en-US", {
              minimumFractionDigits: 0,
              maximumFractionDigits: 0,
            })}{" "}
            difference on this show
          </div>
        )}

      {/* Resolution buttons */}
      {conflict.dismissOnly ? (
        // Dismiss-only conflicts (e.g. total_divergence) show a single
        // acknowledgement button — they don't change the waterfall calculation.
        <button
          onClick={() => onResolve(conflict.id, "structured")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-3 py-2",
            "text-[12px] font-medium leading-snug",
            "ring-1 ring-inset transition-all duration-150 active:translate-y-px",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2",
            "bg-white text-ink-900 ring-ink-200/80 hover:bg-ink-50 shadow-sm",
          )}
        >
          <Check className="h-3 w-3 text-ink-500 shrink-0" />
          Understood — I've reviewed this difference
        </button>
      ) : (
        <div className="flex gap-2 flex-wrap">
          {conflict.resolutionOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onResolve(conflict.id, opt.source)}
              className={cn(
                "inline-flex items-start gap-1.5 rounded-lg px-3 py-2",
                "text-[12px] text-left leading-snug font-medium",
                "ring-1 ring-inset transition-all duration-150 active:translate-y-px",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2",
                "bg-white text-ink-900 ring-ink-200/80 hover:bg-ink-50 shadow-sm",
              )}
            >
              <span
                className={cn(
                  "inline-flex shrink-0 items-center mt-px px-1 py-px rounded text-[8.5px] font-mono uppercase tracking-wider ring-1 ring-inset",
                  opt.source === "notes"
                    ? "bg-amber-50 text-amber-700 ring-amber-200/60"
                    : "bg-ink-100 text-ink-600 ring-ink-200/60",
                )}
              >
                {opt.source === "notes" ? "notes" : "fields"}
              </span>
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
