// Reads from data/greenroom.db via the existing @libsql/client (pure-JS,
// no native compilation) and returns a SettlementInput ready to pass to
// calculateSettlement.
//
// Column-name notes vs. spec terminology:
//   ticket_sales.gross         → SettlementInput.grossRevenue  (summed across rows)
//   ticket_sales.fees          → SettlementInput.platformFees  (summed across rows)
//   ticket_sales.qty           → SettlementInput.ticketsSold   (summed across rows)
//   deals.guarantee_amount     → SettlementInput.guarantee
//   deals.percentage           → stored as 0–1 decimal; multiplied ×100 here
//   deals.percentage_basis     → SettlementInput.percentageBase
//   shows.date                 → the date column (spec called it show_date)

import { client } from "@/db";
import type { SettlementInput, BonusEntry, DealType } from "./calculateSettlement";

// ---------------------------------------------------------------------------
// Bonus format mapping — DB → BonusEntry
// ---------------------------------------------------------------------------
// The DB's bonuses_json was seeded before the current BonusEntry schema was
// defined. 'gross_threshold' and 'attendance_threshold' are the most common
// legacy types; they map cleanly to 'flat_threshold' with the stored amount.
// 'sellout' bonuses require venue capacity (not available here) so they're
// skipped — they appear in the freetext notes instead.

function mapDbBonus(raw: Record<string, unknown>): BonusEntry[] {
  if (!raw || typeof raw.type !== "string") return [];
  switch (raw.type) {
    case "flat_threshold":
      return [
        {
          type: "flat_threshold",
          threshold: Number(raw.threshold ?? 0),
          bonusAmount: Number(raw.bonusAmount ?? 0),
        },
      ];
    case "gross_threshold": // legacy — fixed $ when gross > threshold
    case "attendance_threshold": // same shape, keyed on tickets instead of gross
      // Walkout-labeled gross_threshold bonuses become a walkout_pot comparison
      // branch in the vs deal. The stored `amount` is a pre-calculation snapshot;
      // we re-derive the pot dynamically from the threshold and gross.
      if (typeof raw.label === "string" && /walkout|pot/i.test(raw.label)) {
        const pctMatch = raw.label.match(/(\d+)%/);
        return [
          {
            type: "walkout_pot",
            threshold: Number(raw.threshold ?? 0),
            bonusPercentage: pctMatch ? Number(pctMatch[1]) : 100,
            thresholdType: "gross",
          },
        ];
      }
      return [
        {
          type: "flat_threshold",
          threshold: Number(raw.threshold ?? 0),
          bonusAmount: Number(raw.amount ?? raw.bonusAmount ?? 0),
        },
      ];
    case "walkout_pot":
      return [
        {
          type: "walkout_pot",
          threshold: Number(raw.threshold ?? 0),
          bonusPercentage: Number(raw.bonusPercentage ?? 100),
          thresholdType: raw.thresholdType === "gross" ? "gross" : "breakeven",
        },
      ];
    case "sellout":
    case "tier_ratchet":
    default:
      return []; // drop unsupported types
  }
}

// ---------------------------------------------------------------------------
// Deal type mapping
// ---------------------------------------------------------------------------

function mapDealType(raw: string): DealType {
  const v = raw.toLowerCase().trim();
  if (v === "flat") return "flat";
  if (v === "vs" || v === "vs_deal" || v === "vs deal") return "vs";
  if (v === "door" || v === "door_deal") return "door";
  if (
    v === "percentage_of_gross" ||
    v === "percent_gross" ||
    v === "% of gross"
  )
    return "percent_gross";
  if (v === "percentage_of_net" || v === "percent_net" || v === "% of net")
    return "percent_net";
  return "flat"; // safest default
}

// ---------------------------------------------------------------------------
// loadShowData
// ---------------------------------------------------------------------------

export async function loadShowData(showId: string): Promise<SettlementInput> {
  // Run all queries in parallel — they're independent reads.
  const [showResult, ticketResult, expenseResult, compResult, dealResult] =
    await Promise.all([
      client.execute({
        sql: "SELECT id, venue_id, artist_id, date, status FROM shows WHERE id = ?",
        args: [showId],
      }),
      client.execute({
        sql: "SELECT qty, gross, fees FROM ticket_sales WHERE show_id = ?",
        args: [showId],
      }),
      client.execute({
        sql: "SELECT category, description, amount, absorbed_by_venue FROM expenses WHERE show_id = ?",
        args: [showId],
      }),
      client.execute({
        sql: "SELECT category, count, face_value, counts_toward_gross FROM comps WHERE show_id = ?",
        args: [showId],
      }),
      client.execute({
        sql: `SELECT deal_type, guarantee_amount, percentage, percentage_basis,
                     expense_cap, hospitality_cap, bonuses_json, deal_notes_freetext
              FROM deals WHERE show_id = ? LIMIT 1`,
        args: [showId],
      }),
    ]);

  if (showResult.rows.length === 0) {
    throw new Error(`Show not found: ${showId}`);
  }

  // ── Ticket sales ──────────────────────────────────────────────────────────

  const grossRevenue = ticketResult.rows.reduce(
    (s, r) => s + Number(r.gross ?? 0),
    0,
  );
  const platformFees = ticketResult.rows.reduce(
    (s, r) => s + Number(r.fees ?? 0),
    0,
  );
  const ticketsSold = ticketResult.rows.reduce(
    (s, r) => s + Number(r.qty ?? 0),
    0,
  );

  // ── Expenses ──────────────────────────────────────────────────────────────

  const expenses = expenseResult.rows.map((r) => ({
    category: String(r.category ?? ""),
    description: r.description ? String(r.description) : "",
    amount: Number(r.amount ?? 0),
    absorbedByVenue: Number(r.absorbed_by_venue ?? 0),
  }));

  // ── Comps ─────────────────────────────────────────────────────────────────

  const comps = compResult.rows.map((r) => ({
    category: String(r.category ?? ""),
    count: Number(r.count ?? 0),
    faceValue: Number(r.face_value ?? 0),
    countsTowardGross: Number(r.counts_toward_gross) === 1,
  }));

  // ── Deal ──────────────────────────────────────────────────────────────────

  const deal = dealResult.rows[0] ?? null;
  const dealType: DealType = deal ? mapDealType(String(deal.deal_type)) : "flat";

  // DB stores percentage as 0–1 (e.g. 0.85); SettlementInput expects 0–100
  const percentage = deal?.percentage != null ? Number(deal.percentage) * 100 : 0;

  const percentageBase: "net" | "gross" = (() => {
    const basis = deal?.percentage_basis
      ? String(deal.percentage_basis).toLowerCase()
      : "";
    if (basis === "gross") return "gross";
    if (basis === "net") return "net";
    return deal?.deal_type &&
      String(deal.deal_type).toLowerCase().includes("gross")
      ? "gross"
      : "net";
  })();

  let bonusesJson: BonusEntry[] = [];
  if (deal?.bonuses_json) {
    try {
      const parsed = JSON.parse(String(deal.bonuses_json));
      if (Array.isArray(parsed)) {
        bonusesJson = parsed.flatMap(mapDbBonus);
      }
    } catch {
      // Malformed JSON — treat as no bonuses
    }
  }

  return {
    dealType,
    guarantee: deal?.guarantee_amount != null ? Number(deal.guarantee_amount) : 0,
    percentage,
    percentageBase,
    expenseCap: deal?.expense_cap != null ? Number(deal.expense_cap) : 999_999,
    hospitalityCap:
      deal?.hospitality_cap != null ? Number(deal.hospitality_cap) : 999_999,
    bonusesJson,
    notesFreetext: deal?.deal_notes_freetext
      ? String(deal.deal_notes_freetext)
      : "",

    grossRevenue,
    platformFees,
    ticketsSold,

    expenses,
    comps,
  };
}

// ---------------------------------------------------------------------------
// getSettlementRecord
// ---------------------------------------------------------------------------

export async function getSettlementRecord(showId: string) {
  const result = await client.execute({
    sql: `SELECT id, show_id, status,
                 drafted_at, submitted_at, review_started_at,
                 signed_at, disputed_at, revised_at,
                 finalized_at, paid_at, completed_at,
                 completed_by_user_id,
                 gross_box_office, net_box_office, total_expenses, total_to_artist,
                 calculation_json, recoups_json, signoff_text, notes
          FROM settlements WHERE show_id = ?`,
    args: [showId],
  });
  return result.rows[0] ?? null;
}
