import { readFile } from 'node:fs/promises'
import { estimatePlanMonthlyUsd } from '../dist/mapping.js'

const planFile = process.env.PLAN_JSON
const budget = Number(process.env.COST_BUDGET_USD ?? '10')

if (!planFile) {
  console.error('PLAN_JSON is required')
  process.exit(2)
}

if (!Number.isFinite(budget)) {
  console.error('COST_BUDGET_USD must be numeric')
  process.exit(2)
}

const plan = await readFile(planFile, 'utf8')
const planUsd = estimatePlanMonthlyUsd(plan)
const pass = planUsd <= budget

console.log('budget-usd=' + budget)
console.log('plan-usd=' + planUsd)
console.log('gate=' + (pass ? 'pass' : 'fail'))

process.exit(pass ? 0 : 1)
