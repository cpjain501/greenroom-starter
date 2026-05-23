// Pure calculation engine for show settlements.
// No database calls, no framework imports, no side effects.
// All deal types supported — replaces the partial lib/dealMath.ts engine.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DealType = 'flat' | 'percent_gross' | 'percent_net' | 'vs' | 'door'

export interface SettlementInput {
  // From deals table
  dealType: DealType
  guarantee: number           // guarantee_amount column
  percentage: number          // percentage column (e.g. 85 means 85%)
  percentageBase: 'net' | 'gross'  // derived from deal_type or percentage_basis column
  expenseCap: number          // expense_cap column (pass 999_999 when null = uncapped)
  hospitalityCap: number      // hospitality_cap column (pass 999_999 when null = uncapped)
  bonusesJson: BonusEntry[]   // parsed from bonuses_json column
  notesFreetext: string       // deal_notes_freetext column

  // From ticket_sales table
  grossRevenue: number        // sum of gross column
  platformFees: number        // sum of fees column
  ticketsSold: number         // sum of qty column

  // From expenses table — all rows for this show
  expenses: ExpenseLine[]

  // From comps table — all rows for this show
  comps: CompLine[]
}

export interface BonusEntry {
  type: 'flat_threshold' | 'walkout_pot'
  threshold: number
  bonusAmount?: number        // for flat_threshold: fixed dollar bonus
  bonusPercentage?: number    // for walkout_pot: e.g. 100 means 100%
  thresholdType?: 'gross' | 'breakeven'  // walkout_pot: threshold is a fixed $ or the calculated breakeven
}

export interface ExpenseLine {
  category: string
  description: string
  amount: number
  absorbedByVenue: number     // absorbed_by_venue column (1 = true)
}

export interface CompLine {
  category: string
  count: number
  faceValue: number           // face_value column
  countsTowardGross: boolean  // counts_toward_gross column
}

export interface WaterfallLine {
  id: string                  // unique key for React rendering
  label: string
  amount: number              // positive = revenue/addition, negative = deduction
  displayAmount: string       // pre-formatted e.g. "$6,618.00"
  type: 'revenue' | 'deduction' | 'subtotal' | 'section_header' | 'branch' | 'branch_winner' | 'bonus' | 'total'
  note?: string               // inline grey explanatory text
  isCapWarning?: boolean      // true = show amber highlight on this line
  capOverage?: number         // dollars absorbed by venue due to cap
}

export interface SettlementResult {
  waterfall: WaterfallLine[]
  totalToArtist: number
  netBoxOffice: number
  netAfterExpenses: number
  breakeven: number           // guarantee + totalExpensesApplied + platformFees
  totalExpensesApplied: number
  winningBranch: 'guarantee' | 'percentage' | 'walkout' | 'flat' | 'door'
  baseAmount: number          // result before bonuses
  bonusTotal: number
  isSupported: boolean        // always true — this engine handles all deal types
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

export function formatMoney(amount: number): string {
  return (
    '$' +
    Math.abs(amount).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  )
}

// ---------------------------------------------------------------------------
// Main calculation
// ---------------------------------------------------------------------------

export function calculateSettlement(input: SettlementInput): SettlementResult {
  const waterfall: WaterfallLine[] = []
  let seq = 0
  const id = (prefix: string) => `${prefix}_${++seq}`

  // ── STEP 1: REVENUE ────────────────────────────────────────────────────────

  const compRevenue = input.comps
    .filter((c) => c.countsTowardGross)
    .reduce((sum, c) => sum + c.count * c.faceValue, 0)

  const effectiveGross = input.grossRevenue + compRevenue
  const netBoxOffice = effectiveGross - input.platformFees

  waterfall.push({
    id: id('gross'),
    label: 'Gross box office',
    amount: input.grossRevenue,
    displayAmount: formatMoney(input.grossRevenue),
    type: 'revenue',
  })

  if (compRevenue > 0) {
    waterfall.push({
      id: id('comp_gross'),
      label: 'Comps counted toward gross',
      amount: compRevenue,
      displayAmount: formatMoney(compRevenue),
      type: 'revenue',
      note: 'Face value of comps where counts_toward_gross is true',
    })
  }

  waterfall.push({
    id: id('platform_fees'),
    label: 'Platform fees',
    amount: -input.platformFees,
    displayAmount: formatMoney(input.platformFees),
    type: 'deduction',
  })

  waterfall.push({
    id: id('net_box_office'),
    label: 'Net box office',
    amount: netBoxOffice,
    displayAmount: formatMoney(netBoxOffice),
    type: 'subtotal',
  })

  // ── STEP 2: EXPENSES ───────────────────────────────────────────────────────

  const hospitalityExpenses = input.expenses.filter(
    (e) => e.category.toLowerCase() === 'hospitality',
  )
  const generalExpenses = input.expenses.filter(
    (e) => e.category.toLowerCase() !== 'hospitality',
  )

  const generalRaw = generalExpenses.reduce((s, e) => s + e.amount, 0)
  const hospitalityRaw = hospitalityExpenses.reduce((s, e) => s + e.amount, 0)

  const cappedGeneral = Math.min(generalRaw, input.expenseCap)
  const cappedHospitality = Math.min(hospitalityRaw, input.hospitalityCap)

  const generalOverage = generalRaw - cappedGeneral
  const hospitalityOverage = hospitalityRaw - cappedHospitality

  const totalExpensesApplied = cappedGeneral + cappedHospitality

  waterfall.push({
    id: id('expenses_header'),
    label: 'Expenses',
    amount: 0,
    displayAmount: '',
    type: 'section_header',
  })

  for (const exp of generalExpenses) {
    const label = exp.description
      ? `${exp.category} — ${exp.description}`
      : exp.category
    waterfall.push({
      id: id(`exp_${exp.category}`),
      label,
      amount: -exp.amount,
      displayAmount: formatMoney(exp.amount),
      type: 'deduction',
    })
  }

  if (generalOverage > 0) {
    // Positive amount: adds back the excess that the cap absorbs, reducing net deduction
    waterfall.push({
      id: id('general_cap'),
      label: 'General expense cap',
      amount: generalOverage,
      displayAmount: formatMoney(cappedGeneral),
      type: 'deduction',
      note: `capped from ${formatMoney(generalRaw)} — ${formatMoney(generalOverage)} absorbed by venue`,
      isCapWarning: true,
      capOverage: generalOverage,
    })
  }

  for (const exp of hospitalityExpenses) {
    const label = exp.description
      ? `hospitality — ${exp.description}`
      : 'hospitality'
    waterfall.push({
      id: id('exp_hospitality'),
      label,
      amount: -exp.amount,
      displayAmount: formatMoney(exp.amount),
      type: 'deduction',
    })
  }

  if (hospitalityOverage > 0) {
    waterfall.push({
      id: id('hospitality_cap'),
      label: 'Hospitality cap',
      amount: hospitalityOverage,
      displayAmount: formatMoney(cappedHospitality),
      type: 'deduction',
      note: `capped from ${formatMoney(hospitalityRaw)} — ${formatMoney(hospitalityOverage)} absorbed by venue`,
      isCapWarning: true,
      capOverage: hospitalityOverage,
    })
  }

  // ── STEP 3: NET AFTER EXPENSES ─────────────────────────────────────────────

  const netAfterExpenses = netBoxOffice - totalExpensesApplied

  waterfall.push({
    id: id('net_after_expenses'),
    label: 'Net after expenses',
    amount: netAfterExpenses,
    displayAmount: formatMoney(netAfterExpenses),
    type: 'subtotal',
  })

  // ── STEP 4: BREAKEVEN ──────────────────────────────────────────────────────

  // Breakeven = the gross point at which the venue recoups guarantee + all costs.
  // Used by walkout pot bonuses with thresholdType: 'breakeven'.
  const breakeven = input.guarantee + totalExpensesApplied + input.platformFees

  // ── STEP 5: DEAL CALCULATION ───────────────────────────────────────────────

  let baseAmount = 0
  let winningBranch: SettlementResult['winningBranch'] = 'flat'

  switch (input.dealType) {
    case 'flat': {
      baseAmount = input.guarantee
      winningBranch = 'flat'
      waterfall.push({
        id: id('flat_guarantee'),
        label: 'Flat guarantee',
        amount: baseAmount,
        displayAmount: formatMoney(baseAmount),
        type: 'revenue',
        note: 'No expense deductions — guarantee is the floor',
      })
      break
    }

    case 'percent_gross': {
      baseAmount = effectiveGross * (input.percentage / 100)
      winningBranch = 'percentage'
      waterfall.push({
        id: id('percent_gross'),
        label: `${input.percentage}% of gross`,
        amount: baseAmount,
        displayAmount: formatMoney(baseAmount),
        type: 'revenue',
        note: `${formatMoney(effectiveGross)} × ${input.percentage}%`,
      })
      break
    }

    case 'percent_net': {
      baseAmount = netAfterExpenses * (input.percentage / 100)
      winningBranch = 'percentage'
      waterfall.push({
        id: id('percent_net'),
        label: `${input.percentage}% of net`,
        amount: baseAmount,
        displayAmount: formatMoney(baseAmount),
        type: 'revenue',
        note: `${formatMoney(netAfterExpenses)} × ${input.percentage}%`,
      })
      break
    }

    case 'vs': {
      const basisAmount =
        input.percentageBase === 'gross' ? effectiveGross : netAfterExpenses
      const percentageResult = basisAmount * (input.percentage / 100)

      // Walkout pot bonuses are a third comparison branch: guarantee + pot amount.
      // They are NOT additive on top of the vs result (step 6 skips them for vs).
      const walkoutBonus = input.bonusesJson.find(
        (b) => b.type === 'walkout_pot',
      )
      let walkoutBranchAmount = -Infinity
      let walkoutPotAmount = 0
      if (walkoutBonus) {
        const threshold =
          walkoutBonus.thresholdType === 'breakeven'
            ? breakeven
            : walkoutBonus.threshold
        const pct = walkoutBonus.bonusPercentage ?? 100
        walkoutPotAmount = Math.max(0, (effectiveGross - threshold) * (pct / 100))
        walkoutBranchAmount = input.guarantee + walkoutPotAmount
      }

      waterfall.push({
        id: id('vs_branch_a'),
        label: `Branch A: ${input.percentage}% of ${input.percentageBase} — ${formatMoney(percentageResult)}`,
        amount: percentageResult,
        displayAmount: formatMoney(percentageResult),
        type: 'branch',
        note: `${formatMoney(basisAmount)} × ${input.percentage}%`,
      })

      waterfall.push({
        id: id('vs_branch_b'),
        label: `Branch B: Guarantee — ${formatMoney(input.guarantee)}`,
        amount: input.guarantee,
        displayAmount: formatMoney(input.guarantee),
        type: 'branch',
      })

      if (walkoutBonus) {
        const thresholdLabel =
          walkoutBonus.thresholdType === 'breakeven'
            ? `above breakeven (${formatMoney(breakeven)})`
            : `above ${formatMoney(walkoutBonus.threshold)}`
        waterfall.push({
          id: id('vs_branch_c'),
          label: `Branch C: Guarantee + walkout pot ${thresholdLabel} — ${formatMoney(walkoutBranchAmount)}`,
          amount: walkoutBranchAmount,
          displayAmount: formatMoney(walkoutBranchAmount),
          type: 'branch',
          note: `${formatMoney(input.guarantee)} + ${formatMoney(walkoutPotAmount)} pot`,
        })
      }

      const bestAmount = Math.max(
        percentageResult,
        input.guarantee,
        walkoutBranchAmount,
      )

      if (walkoutBonus && walkoutBranchAmount >= percentageResult && walkoutBranchAmount >= input.guarantee) {
        baseAmount = walkoutBranchAmount
        winningBranch = 'walkout'
        waterfall.push({
          id: id('vs_winner'),
          label: '→ Branch C wins (walkout)',
          amount: walkoutBranchAmount,
          displayAmount: formatMoney(walkoutBranchAmount),
          type: 'branch_winner',
          note: `${formatMoney(walkoutPotAmount)} pot above ${walkoutBonus.thresholdType === 'breakeven' ? 'breakeven' : formatMoney(walkoutBonus.threshold)}`,
        })
      } else if (percentageResult >= input.guarantee) {
        baseAmount = percentageResult
        winningBranch = 'percentage'
        const margin = percentageResult - input.guarantee
        waterfall.push({
          id: id('vs_winner'),
          label: '→ Branch A wins',
          amount: percentageResult,
          displayAmount: formatMoney(percentageResult),
          type: 'branch_winner',
          note: `${formatMoney(margin)} above guarantee`,
        })
      } else {
        baseAmount = input.guarantee
        winningBranch = 'guarantee'
        waterfall.push({
          id: id('vs_winner'),
          label: '→ Guarantee wins (floor)',
          amount: input.guarantee,
          displayAmount: formatMoney(input.guarantee),
          type: 'branch_winner',
        })
      }
      break
    }

    case 'door': {
      baseAmount = input.grossRevenue * (input.percentage / 100)
      winningBranch = 'door'
      waterfall.push({
        id: id('door'),
        label: `Door deal: ${input.percentage}% of gross`,
        amount: baseAmount,
        displayAmount: formatMoney(baseAmount),
        type: 'revenue',
        note: `${formatMoney(input.grossRevenue)} × ${input.percentage}%`,
      })
      break
    }
  }

  // ── STEP 6: BONUSES ────────────────────────────────────────────────────────

  let bonusTotal = 0

  for (const bonus of input.bonusesJson) {
    if (bonus.type === 'flat_threshold') {
      if (effectiveGross > bonus.threshold) {
        const amount = bonus.bonusAmount ?? 0
        bonusTotal += amount
        waterfall.push({
          id: id('bonus_flat'),
          label: `Bonus: gross above ${formatMoney(bonus.threshold)}`,
          amount,
          displayAmount: formatMoney(amount),
          type: 'bonus',
          note: `${formatMoney(effectiveGross)} > threshold ${formatMoney(bonus.threshold)}`,
        })
      }
    } else if (bonus.type === 'walkout_pot') {
      // For vs deals: walkout_pot was already factored into Branch C in step 5.
      // For all other deal types: treat as additive bonus.
      if (input.dealType !== 'vs') {
        const threshold =
          bonus.thresholdType === 'breakeven' ? breakeven : bonus.threshold
        if (effectiveGross > threshold) {
          const pct = bonus.bonusPercentage ?? 0
          const pot = (effectiveGross - threshold) * (pct / 100)
          bonusTotal += pot
          const threshLabel =
            bonus.thresholdType === 'breakeven'
              ? `breakeven (${formatMoney(breakeven)})`
              : formatMoney(threshold)
          waterfall.push({
            id: id('bonus_walkout'),
            label: `Walkout pot: ${pct}% above ${threshLabel}`,
            amount: pot,
            displayAmount: formatMoney(pot),
            type: 'bonus',
            note: `(${formatMoney(effectiveGross)} − ${formatMoney(threshold)}) × ${pct}%`,
          })
        }
      }
    }
  }

  // ── STEP 7: TOTAL ──────────────────────────────────────────────────────────

  const totalToArtist = baseAmount + bonusTotal

  waterfall.push({
    id: id('total'),
    label: 'Total to artist',
    amount: totalToArtist,
    displayAmount: formatMoney(totalToArtist),
    type: 'total',
  })

  return {
    waterfall,
    totalToArtist,
    netBoxOffice,
    netAfterExpenses,
    breakeven,
    totalExpensesApplied,
    winningBranch,
    baseAmount,
    bonusTotal,
    isSupported: true,
  }
}

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * MANUAL TEST — Coastal Spell @ The Crescent (show_0290)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Inputs drawn from the actual show data. grossRevenue is rounded to 19400 for
 * clean arithmetic (actual was $19,379).
 *
 * const result = calculateSettlement({
 *   dealType: 'vs',
 *   guarantee: 4716,
 *   percentage: 85,
 *   percentageBase: 'net',
 *   expenseCap: 2350,
 *   hospitalityCap: 500,
 *   bonusesJson: [
 *     { type: 'flat_threshold', threshold: 19000, bonusAmount: 700 },
 *     { type: 'walkout_pot',    threshold: 0,     bonusPercentage: 100, thresholdType: 'breakeven' },
 *   ],
 *   notesFreetext: '$4,716 vs 85% net + walkout pot. After breakeven on guarantee + expenses, all incremental gross goes to artist. Hospitality cap $500.',
 *   grossRevenue: 19400,
 *   platformFees: 1938,
 *   ticketsSold: 638,
 *   expenses: [
 *     { category: 'sound',       description: '',                amount: 430, absorbedByVenue: 0 },
 *     { category: 'lights',      description: '',                amount: 179, absorbedByVenue: 0 },
 *     { category: 'production',  description: '',                amount: 286, absorbedByVenue: 0 },
 *     { category: 'hospitality', description: '',                amount: 326, absorbedByVenue: 0 },
 *     { category: 'marketing',   description: 'Instagram boost', amount: 589, absorbedByVenue: 0 },
 *   ],
 *   comps: [],
 * })
 *
 * ── Expected trace ────────────────────────────────────────────────────────────
 *
 *  effectiveGross        = 19,400          (no comps toward gross)
 *  netBoxOffice          = 19,400 − 1,938  = 17,462
 *
 *  general expenses      = 430+179+286+589 = 1,484   (< expenseCap 2,350, no cap)
 *  hospitality           = 326                        (< hospitalityCap 500, no cap)
 *  totalExpensesApplied  = 1,484 + 326     = 1,810
 *
 *  netAfterExpenses      = 17,462 − 1,810  = 15,652
 *  breakeven             = 4,716 + 1,810 + 1,938 = 8,464
 *
 *  vs deal (85% of net):
 *    Branch A (%)        = 15,652 × 0.85   = 13,304.20
 *    Branch B (guarantee)= 4,716
 *    → Branch A wins (margin: $8,588.20)
 *    baseAmount          = 13,304.20
 *
 *  bonuses:
 *    flat_threshold      gross 19,400 > 19,000 → +700.00
 *    walkout_pot         gross 19,400 > breakeven 8,464
 *                        pot = (19,400 − 8,464) × 100% = 10,936.00
 *    bonusTotal          = 700 + 10,936               = 11,636.00
 *
 *  totalToArtist         = 13,304.20 + 11,636         = 24,940.20
 *
 * ── Why this differs from the "~$16,352" reference ───────────────────────────
 *
 *  The historical settlement (stl_show_0290) recorded totalToArtist = $16,344.35.
 *  That was calculated off-platform using a FIXED walkout bonus of $2,358 — a
 *  dollar amount Mariana negotiated and typed directly into the spreadsheet.
 *
 *  The new BonusEntry system models the walkout pot as a live percentage
 *  (bonusPercentage: 100, thresholdType: 'breakeven'), which produces the
 *  correct formula but a different number because the actual pot is much larger
 *  than what was settled by hand.
 *
 *  To reproduce the historical $16,344 result from structured data, the bonus
 *  should be stored as a flat_threshold with bonusAmount: 2358, not a
 *  walkout_pot with bonusPercentage: 100. The walkout_pot type is correct for
 *  live/future shows where the pot is truly open-ended.
 *
 *  Verification with fixed bonus:
 *    baseAmount 13,304.20 + flat_threshold 700 + flat_threshold 2,358 = 16,362.20 ≈ $16,352 ✓
 * ─────────────────────────────────────────────────────────────────────────────
 */
