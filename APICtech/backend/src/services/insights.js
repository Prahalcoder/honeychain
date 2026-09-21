// AI finance and production intelligence for a keeper. Statistical model
// (least-squares trend plus moving averages) over the company's own private
// records. It is decision support: forecasts widen as history gets shorter.

const round = (value, digits = 0) => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function linearForecast(values) {
  const n = values.length
  if (n === 0) return { next: 0, slope: 0 }
  if (n === 1) return { next: values[0], slope: 0 }

  const meanX = (n - 1) / 2
  const meanY = values.reduce((sum, value) => sum + value, 0) / n
  let numerator = 0
  let denominator = 0

  values.forEach((value, index) => {
    numerator += (index - meanX) * (value - meanY)
    denominator += (index - meanX) ** 2
  })

  const slope = denominator === 0 ? 0 : numerator / denominator
  return { next: Math.max(0, meanY + slope * (n - meanX)), slope }
}

function monthKeys(count) {
  const now = new Date()

  return Array.from({ length: count }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (count - 1 - index), 1)
    return date.toLocaleDateString('en-CA').slice(0, 7)
  })
}

export function buildInsights({ finance, harvests }) {
  const months = monthKeys(6)
  const byMonth = new Map()

  for (const entry of finance) {
    const key = entry.entry_date.slice(0, 7)
    const bucket = byMonth.get(key) || { income: 0, expense: 0 }
    if (entry.type === 'INCOME') bucket.income += entry.amount_inr
    else bucket.expense += entry.amount_inr
    byMonth.set(key, bucket)
  }

  const harvestByMonth = new Map()
  for (const harvest of harvests) {
    const key = harvest.harvest_date.slice(0, 7)
    harvestByMonth.set(key, (harvestByMonth.get(key) || 0) + harvest.quantity_kg)
  }

  const history = months.map((month) => ({
    month,
    income: byMonth.get(month)?.income || 0,
    expense: byMonth.get(month)?.expense || 0,
    honeyKg: harvestByMonth.get(month) || 0,
  }))

  // Forecast from the months that have data, ignoring leading empty months.
  const firstActive = history.findIndex((row) => row.income > 0 || row.expense > 0 || row.honeyKg > 0)
  const active = firstActive === -1 ? [] : history.slice(firstActive)
  const completed = active.filter((row) => row.month !== months.at(-1))
  const usable = completed.length >= 2 ? completed : active

  const income = linearForecast(usable.map((row) => row.income))
  const expense = linearForecast(usable.map((row) => row.expense))
  const production = linearForecast(usable.map((row) => row.honeyKg))

  const confidence = usable.length >= 5 ? 'MEDIUM' : usable.length >= 3 ? 'LOW' : 'VERY_LOW'
  const spread = { MEDIUM: 0.15, LOW: 0.25, VERY_LOW: 0.4 }[confidence]

  const totals = finance.reduce((acc, entry) => {
    if (entry.type === 'INCOME') acc.income += entry.amount_inr
    else {
      acc.expense += entry.amount_inr
      acc.categories[entry.category] = (acc.categories[entry.category] || 0) + entry.amount_inr
    }
    return acc
  }, { income: 0, expense: 0, categories: {} })

  const totalKg = harvests.reduce((sum, harvest) => sum + harvest.quantity_kg, 0)
  const thisMonth = history.at(-1)
  const lastMonth = history.at(-2)

  const categories = Object.entries(totals.categories)
    .map(([category, amount]) => ({ category, amount, share: totals.expense ? round((amount / totals.expense) * 100, 1) : 0 }))
    .sort((a, b) => b.amount - a.amount)

  const insights = []

  if (categories[0] && categories[0].share >= 45) {
    insights.push({ level: 'INFO', title: `${categories[0].category} is ${categories[0].share}% of your spending`, detail: 'A single category dominates costs. Compare supplier prices or plan purchases in bulk.' })
  }

  if (lastMonth && lastMonth.expense > 0 && thisMonth.expense > lastMonth.expense * 1.25) {
    insights.push({ level: 'WARNING', title: 'Spending is up more than 25% on last month', detail: `${round(thisMonth.expense)} this month against ${round(lastMonth.expense)} last month.` })
  }

  if (totals.income > 0) {
    const margin = ((totals.income - totals.expense) / totals.income) * 100
    insights.push({
      level: margin < 15 ? 'WARNING' : 'GOOD',
      title: `Overall margin is ${round(margin)}%`,
      detail: margin < 15 ? 'Costs take most of your income. Review the largest expense categories.' : 'Income comfortably covers costs.',
    })
  }

  if (totalKg > 0 && totals.income > 0) {
    insights.push({ level: 'INFO', title: `Income per kilogram harvested: ₹${round(totals.income / totalKg)}`, detail: 'Based on all recorded income against all recorded harvests.' })
  }

  if (income.slope > 0 && usable.length >= 3) {
    insights.push({ level: 'GOOD', title: 'Income is trending upward', detail: `About ₹${round(income.slope)} more each month over the last ${usable.length} months.` })
  } else if (income.slope < 0 && usable.length >= 3) {
    insights.push({ level: 'WARNING', title: 'Income is trending downward', detail: `About ₹${round(-income.slope)} less each month over the last ${usable.length} months.` })
  }

  if (usable.length < 3) {
    insights.push({ level: 'INFO', title: 'More history will sharpen these forecasts', detail: 'Record income, expenses and harvests each month. Forecasts need at least three months to show a trend.' })
  }

  return {
    engine: 'statistical-v1',
    method: 'Least-squares trend over recent months',
    confidence,
    monthsUsed: usable.length,
    history,
    forecast: {
      month: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toLocaleDateString('en-CA').slice(0, 7),
      income: { expected: round(income.next), low: round(income.next * (1 - spread)), high: round(income.next * (1 + spread)) },
      expense: { expected: round(expense.next), low: round(expense.next * (1 - spread)), high: round(expense.next * (1 + spread)) },
      profit: { expected: round(income.next - expense.next) },
      honeyKg: { expected: round(production.next, 1), low: round(production.next * (1 - spread), 1), high: round(production.next * (1 + spread), 1) },
    },
    economics: {
      totalIncome: round(totals.income),
      totalExpense: round(totals.expense),
      totalHoneyKg: round(totalKg, 1),
      incomePerKg: totalKg > 0 ? round(totals.income / totalKg) : null,
      costPerKg: totalKg > 0 ? round(totals.expense / totalKg) : null,
      categories,
    },
    insights,
  }
}
