// Detects mismatches between deal_notes_freetext (what Mariana wrote from the
// agent email thread) and the structured fields stored in the deals table.
// Uses regex pattern matching only — no LLM API, no network calls.
//
// UPGRADE PATH: The ConflictResult interface and detectConflicts signature are
// designed to be compatible with an LLM-backed implementation. To upgrade,
// replace the function body with an Anthropic API call that receives
// notesFreetext + structured values and returns the same ConflictResult[] shape.
// Call sites, UI rendering, and resolution handling don't change.

import { formatMoney } from './calculateSettlement'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConflictResult {
  id: string
  severity: 'high' | 'medium'
  field: string
  structuredValue: string
  notesValue: string
  description: string
  estimatedDollarImpact?: number
  resolutionOptions: Array<{
    label: string
    value: string
    source: 'structured' | 'notes'
  }>
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export function detectConflicts(
  notesFreetext: string,
  structured: {
    guarantee: number
    percentage: number
    expenseCap: number
    hospitalityCap: number
    bonuses: any[]
    dealType: string
  },
  actuals: {
    grossRevenue: number
    platformFees: number
    totalExpenses: number
  },
): ConflictResult[] {
  const conflicts: ConflictResult[] = []
  const notes = notesFreetext

  // ── RULE 1: Walkout pot "breakeven" vs fixed threshold ─────────────────────
  //
  // Notes say the pot triggers at breakeven (dynamic), but the structured bonus
  // stores a fixed dollar threshold — these produce different payouts.

  const mentionsBreakeven = /break[\s-]?even/i.test(notes)
  const walkoutBonus = structured.bonuses.find(
    (b: any) => b.type === 'walkout_pot' && typeof b.threshold === 'number',
  )

  if (mentionsBreakeven && walkoutBonus) {
    const fixedThreshold: number = walkoutBonus.threshold
    const bonusPct: number = walkoutBonus.bonusPercentage ?? 100
    const { grossRevenue, platformFees, totalExpenses } = actuals

    const fixedPot = Math.max(0, ((grossRevenue - fixedThreshold) * bonusPct) / 100)
    const breakeven = structured.guarantee + totalExpenses + platformFees
    const breakevenPot = Math.max(0, ((grossRevenue - breakeven) * bonusPct) / 100)
    const impact = Math.abs(fixedPot - breakevenPot)

    conflicts.push({
      id: 'walkout_threshold_type',
      severity: 'high',
      field: 'bonuses.walkout_pot.threshold',
      structuredValue: `Fixed threshold: ${formatMoney(fixedThreshold)}`,
      notesValue: 'Breakeven (guarantee + expenses + fees)',
      description:
        `Notes say the walkout pot triggers at breakeven, but the structured bonus uses a ` +
        `fixed threshold of ${formatMoney(fixedThreshold)}. ` +
        `At current actuals, this is a ${formatMoney(impact)} difference.`,
      estimatedDollarImpact: impact,
      resolutionOptions: [
        {
          label: `Use breakeven (from notes) — pot is ${formatMoney(breakevenPot)} at current gross`,
          value: 'breakeven',
          source: 'notes',
        },
        {
          label: `Use ${formatMoney(fixedThreshold)} fixed threshold (from structured) — pot is ${formatMoney(fixedPot)}`,
          value: String(fixedThreshold),
          source: 'structured',
        },
      ],
    })
  }

  // ── RULE 2: Guarantee amount mismatch ──────────────────────────────────────

  const guaranteeFromNotes = extractGuarantee(notes)

  if (
    guaranteeFromNotes !== null &&
    Math.abs(guaranteeFromNotes - structured.guarantee) > 5
  ) {
    const impact = Math.abs(guaranteeFromNotes - structured.guarantee)
    conflicts.push({
      id: 'guarantee_mismatch',
      severity: 'medium',
      field: 'guarantee',
      structuredValue: formatMoney(structured.guarantee),
      notesValue: formatMoney(guaranteeFromNotes),
      description:
        `Notes reference ${formatMoney(guaranteeFromNotes)} as the guarantee, ` +
        `but the structured field stores ${formatMoney(structured.guarantee)}.`,
      estimatedDollarImpact: impact,
      resolutionOptions: [
        {
          label: `Use ${formatMoney(guaranteeFromNotes)} (from notes)`,
          value: String(guaranteeFromNotes),
          source: 'notes',
        },
        {
          label: `Use ${formatMoney(structured.guarantee)} (from structured)`,
          value: String(structured.guarantee),
          source: 'structured',
        },
      ],
    })
  }

  // ── RULE 3: Percentage mismatch ────────────────────────────────────────────

  const pctFromNotes = extractPercentage(notes)

  if (pctFromNotes !== null && Math.abs(pctFromNotes - structured.percentage) > 0.5) {
    conflicts.push({
      id: 'percentage_mismatch',
      severity: 'medium',
      field: 'percentage',
      structuredValue: `${structured.percentage}%`,
      notesValue: `${pctFromNotes}%`,
      description:
        `Notes reference ${pctFromNotes}% but the structured field stores ${structured.percentage}%.`,
      resolutionOptions: [
        {
          label: `Use ${pctFromNotes}% (from notes)`,
          value: String(pctFromNotes),
          source: 'notes',
        },
        {
          label: `Use ${structured.percentage}% (from structured)`,
          value: String(structured.percentage),
          source: 'structured',
        },
      ],
    })
  }

  // ── RULE 4: Hospitality cap mismatch ───────────────────────────────────────

  const hospCapFromNotes = extractHospitalityCap(notes)

  if (
    hospCapFromNotes !== null &&
    Math.abs(hospCapFromNotes - structured.hospitalityCap) > 5
  ) {
    const impact = Math.abs(hospCapFromNotes - structured.hospitalityCap)
    conflicts.push({
      id: 'hospitality_cap_mismatch',
      severity: 'medium',
      field: 'hospitalityCap',
      structuredValue: formatMoney(structured.hospitalityCap),
      notesValue: formatMoney(hospCapFromNotes),
      description:
        `Notes set a hospitality cap of ${formatMoney(hospCapFromNotes)}, ` +
        `but the structured field stores ${formatMoney(structured.hospitalityCap)}.`,
      estimatedDollarImpact: impact,
      resolutionOptions: [
        {
          label: `Use ${formatMoney(hospCapFromNotes)} (from notes)`,
          value: String(hospCapFromNotes),
          source: 'notes',
        },
        {
          label: `Use ${formatMoney(structured.hospitalityCap)} (from structured)`,
          value: String(structured.hospitalityCap),
          source: 'structured',
        },
      ],
    })
  }

  return conflicts
}

// ---------------------------------------------------------------------------
// Extraction helpers (private)
// ---------------------------------------------------------------------------

// Strip commas and parse a raw number string.
function parseAmount(raw: string): number | null {
  const val = parseFloat(raw.replace(/,/g, ''))
  return isNaN(val) || val <= 0 ? null : val
}

// Extract a guarantee amount from freetext.
// Strategy: look for dollar amounts adjacent to "vs", "g'tee", or "guarantee"
// keywords. Priority order matches typical deal note phrasing.
function extractGuarantee(notes: string): number | null {
  // Amount BEFORE the keyword: "$4,716 vs"  "$4,716 guarantee"  "4,716 g'tee"
  const before: RegExp[] = [
    /\$([\d,]+(?:\.\d{1,2})?)\s+vs\b/i,
    /\$([\d,]+(?:\.\d{1,2})?)\s+g['']?tee\b/i,
    /\$([\d,]+(?:\.\d{1,2})?)\s+guarantee\b/i,
    /\b([\d,]+(?:\.\d{1,2})?)\s+vs\b/i,
    /\b([\d,]+(?:\.\d{1,2})?)\s+g['']?tee\b/i,
    /\b([\d,]+(?:\.\d{1,2})?)\s+guarantee\b/i,
  ]

  // Keyword BEFORE amount: "guarantee $4,716"  "g'tee $4,716"
  const after: RegExp[] = [
    /\bguarantee\s+\$([\d,]+(?:\.\d{1,2})?)/i,
    /\bg['']?tee\s+\$([\d,]+(?:\.\d{1,2})?)/i,
  ]

  for (const re of [...before, ...after]) {
    const m = notes.match(re)
    if (m) {
      const val = parseAmount(m[1])
      if (val !== null) return val
    }
  }
  return null
}

// Extract the deal percentage from freetext.
// Strategy: find percentages in a deal-structure context ("X% of net", "X/Y net")
// while ignoring bonus percentages ("100% of gross above $X", "if gross > Y").
function extractPercentage(notes: string): number | null {
  // Remove bonus-context percentage phrases before pattern matching to avoid
  // "100% of gross above $5,700" being read as the deal percentage.
  const stripped = notes
    .replace(/\d+%\s+of\s+(?:net|gross)\s+above\b/gi, '')
    .replace(/\bif\s+gross\s*[>≥]/gi, '')
    .replace(/walkout\s+pot[^.;]*/gi, '')

  // Priority order: most specific context first.
  const patterns: Array<[RegExp, 'first' | 'split']> = [
    // "85% of net" / "85% of gross"
    [/(\d{1,3})%\s+of\s+(?:net|gross)/i, 'first'],
    // "85% net" / "85% gross"
    [/(\d{1,3})%\s+(?:net|gross)/i, 'first'],
    // "85/15 net" / "85/15 of net" — first number is artist share
    [/(\d{1,3})\/(\d{1,3})\s+(?:of\s+)?(?:net|gross)/i, 'first'],
    // "85/15" bare split
    [/(\d{1,3})\/(\d{1,3})/i, 'first'],
    // Bare "85%" — last resort; only if no ambiguity from bonus stripping
    [/(\d{1,3})%/i, 'first'],
  ]

  for (const [re] of patterns) {
    const m = stripped.match(re)
    if (m) {
      const val = parseFloat(m[1])
      if (!isNaN(val) && val > 0 && val <= 100) return val
    }
  }
  return null
}

// Extract a hospitality cap amount from freetext.
// Handles "Hospitality cap $500", "hosp cap $500", "hosp $500", etc.
function extractHospitalityCap(notes: string): number | null {
  const patterns: RegExp[] = [
    // "hosp cap $500" / "hospitality cap $500"
    /hosp(?:itality)?\s+cap\s+\$([\d,]+(?:\.\d{1,2})?)/i,
    // "hospitality $500 cap"
    /hosp(?:itality)?\s+\$([\d,]+(?:\.\d{1,2})?)\s+cap/i,
    // "$500 hosp cap" / "$500 hospitality cap"
    /\$([\d,]+(?:\.\d{1,2})?)\s+hosp(?:itality)?\s+cap/i,
    // "hosp $500" — less specific, last resort
    /hosp(?:itality)?\s+\$([\d,]+(?:\.\d{1,2})?)/i,
  ]

  for (const re of patterns) {
    const m = notes.match(re)
    if (m) {
      const val = parseAmount(m[1])
      if (val !== null) return val
    }
  }
  return null
}
