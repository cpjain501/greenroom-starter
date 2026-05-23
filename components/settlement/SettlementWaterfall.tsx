"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  formatMoney,
  type SettlementResult,
  type WaterfallLine,
} from "@/lib/settlement/calculateSettlement";

interface Props {
  result: SettlementResult;
  artistName: string;
  showDate: string;
}

export function SettlementWaterfall({ result, artistName, showDate }: Props) {
  return (
    <Card accent="brand">
      <CardHeader>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-400 mb-1">
            Settlement worksheet
          </div>
          <div className="text-[13px] font-medium text-ink-900">{artistName}</div>
          <div className="text-[11.5px] text-ink-400 mt-0.5">{showDate}</div>
        </div>
      </CardHeader>

      <CardContent className="px-5 py-4">
        <div>
          {result.waterfall.map((line) => (
            <WaterfallRow key={line.id} line={line} />
          ))}
        </div>

        {/* Breakeven callout */}
        <div className="mt-5 flex items-center gap-2 px-3 py-2.5 rounded-lg bg-ink-50/70 ring-1 ring-ink-200/50">
          <div className="text-[11.5px] text-ink-400 leading-relaxed">
            Breakeven for this show:{" "}
            <span className="font-mono tabular text-ink-700">
              {formatMoney(result.breakeven)}
            </span>{" "}
            <span className="text-ink-300">·</span> guarantee + expenses + fees
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Line renderer — one function per type
// ---------------------------------------------------------------------------

function WaterfallRow({ line }: { line: WaterfallLine }) {
  switch (line.type) {
    case "section_header":
      return <SectionHeader line={line} />;
    case "revenue":
      return <RevenueLine line={line} />;
    case "deduction":
      return line.isCapWarning ? (
        <CapLine line={line} />
      ) : (
        <DeductionLine line={line} />
      );
    case "subtotal":
      return <SubtotalLine line={line} />;
    case "branch":
      return <BranchLine line={line} />;
    case "branch_winner":
      return <BranchWinnerLine line={line} />;
    case "bonus":
      return <BonusLine line={line} />;
    case "total":
      return <TotalLine line={line} />;
    default:
      return null;
  }
}

function SectionHeader({ line }: { line: WaterfallLine }) {
  return (
    <div className="pt-4 pb-1.5 first:pt-1">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-400">
        {line.label}
      </div>
      <div className="border-b border-ink-100/80 mt-1.5" />
    </div>
  );
}

function RevenueLine({ line }: { line: WaterfallLine }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="min-w-0">
        <div className="text-[13px] text-ink-600">{line.label}</div>
        {line.note && (
          <div className="text-[11px] text-ink-400 mt-0.5 leading-snug">
            {line.note}
          </div>
        )}
      </div>
      <div
        className={cn(
          "text-[13.5px] font-mono tabular shrink-0",
          line.amount >= 0 ? "text-brand-700" : "text-ink-500",
        )}
      >
        {line.displayAmount}
      </div>
    </div>
  );
}

function DeductionLine({ line }: { line: WaterfallLine }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 pl-3">
      <div className="min-w-0">
        <div className="text-[13px] text-ink-500">
          <span className="text-ink-300 select-none mr-0.5">−</span>
          {line.label}
        </div>
        {line.note && (
          <div className="text-[11px] text-ink-400 mt-0.5 leading-snug">
            {line.note}
          </div>
        )}
      </div>
      <div className="text-[13.5px] font-mono tabular text-ink-400 shrink-0">
        {line.displayAmount}
      </div>
    </div>
  );
}

// Cap adjustment — positive amount added back because the cap was hit.
// Shown in amber to signal the cap was applied and some cost was absorbed.
function CapLine({ line }: { line: WaterfallLine }) {
  return (
    <div className="py-1.5 pl-3">
      <div className="flex items-start justify-between gap-4 bg-amber-50/70 ring-1 ring-amber-200/50 rounded-md px-2.5 py-2">
        <div className="min-w-0">
          <div className="text-[13px] text-amber-800">{line.label}</div>
          {line.note && (
            <div className="text-[11px] text-amber-700/80 mt-0.5 leading-snug">
              {line.note}
            </div>
          )}
        </div>
        <div className="text-[13.5px] font-mono tabular text-amber-700 shrink-0">
          {line.displayAmount}
        </div>
      </div>
    </div>
  );
}

function SubtotalLine({ line }: { line: WaterfallLine }) {
  return (
    <div className="flex items-baseline justify-between py-2.5 mt-0.5 border-t border-ink-100/80">
      <span className="text-[13px] font-medium text-ink-900">{line.label}</span>
      <span className="text-[14px] font-mono tabular font-medium text-ink-900">
        {line.displayAmount}
      </span>
    </div>
  );
}

// Branch lines are shown muted; the winner overrides them visually.
function BranchLine({ line }: { line: WaterfallLine }) {
  return (
    <div className="flex items-baseline justify-between py-1 pl-2">
      <span className="text-[12.5px] text-ink-400">{line.label}</span>
      <span className="text-[12.5px] font-mono tabular text-ink-400">
        {line.displayAmount}
      </span>
    </div>
  );
}

function BranchWinnerLine({ line }: { line: WaterfallLine }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 px-2.5 -mx-1 rounded-md bg-brand-50/60 mb-1 mt-0.5">
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-ink-900">{line.label}</div>
        {line.note && (
          <div className="text-[11px] text-ink-500 mt-0.5 leading-snug">
            {line.note}
          </div>
        )}
      </div>
      <div className="text-[13.5px] font-mono tabular font-semibold text-brand-700 shrink-0">
        {line.displayAmount}
      </div>
    </div>
  );
}

function BonusLine({ line }: { line: WaterfallLine }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="flex items-start gap-2 min-w-0">
        <span className="inline-flex shrink-0 items-center mt-px px-1.5 py-px rounded text-[9px] font-mono uppercase tracking-wider bg-brand-50 ring-1 ring-brand-200/50 text-brand-800">
          bonus
        </span>
        <div className="min-w-0">
          <div className="text-[13px] text-brand-800">{line.label}</div>
          {line.note && (
            <div className="text-[11px] text-ink-400 mt-0.5 leading-snug">
              {line.note}
            </div>
          )}
        </div>
      </div>
      <div className="text-[13.5px] font-mono tabular text-brand-700 shrink-0">
        {line.displayAmount}
      </div>
    </div>
  );
}

function TotalLine({ line }: { line: WaterfallLine }) {
  return (
    <div className="flex items-baseline justify-between pt-4 mt-3 border-t-2 border-ink-900/10">
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-600">
        Total to artist
      </span>
      <span
        className="text-[26px] font-mono tabular font-bold text-brand-700 leading-none"
        style={{ letterSpacing: "-0.025em" }}
      >
        {line.displayAmount}
      </span>
    </div>
  );
}
