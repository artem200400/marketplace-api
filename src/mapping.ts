export type PlanCostRates = {
  cpuPerVcpuHour: number
  memoryPerGiBHour: number
  hoursPerMonth: number
}

export const HW32_RATES: PlanCostRates = {
  cpuPerVcpuHour: 0.0445,
  memoryPerGiBHour: 0.0049225,
  hoursPerMonth: 730
}

function parseCpu(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value !== 'string') return 0
  if (value.endsWith('m')) return Number(value.slice(0, -1)) / 1000
  return Number(value)
}

function parseMemoryGiB(value: unknown): number {
  if (typeof value === 'number') return value / (1024 ** 3)
  if (typeof value !== 'string') return 0

  const match = value.match(/^([0-9.]+)(Ki|Mi|Gi|Ti)?$/)
  if (!match) return 0

  const amount = Number(match[1])
  const unit = match[2] ?? ''
  if (unit === 'Ki') return amount / (1024 ** 2)
  if (unit === 'Mi') return amount / 1024
  if (unit === 'Gi') return amount
  if (unit === 'Ti') return amount * 1024
  return amount / (1024 ** 3)
}

function parsePlan(text: string): unknown[] {
  try {
    return [JSON.parse(text)]
  } catch {
    return text
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => {
        try {
          return JSON.parse(line)
        } catch {
          return null
        }
      })
      .filter(value => value !== null)
  }
}

function findDeploymentInputs(
  value: unknown,
  seen: Set<string>,
  out: unknown[]
): void {
  if (!value || typeof value !== 'object') return

  const object = value as Record<string, unknown>
  const type = typeof object.type === 'string' ? object.type : ''
  const urn = typeof object.urn === 'string' ? object.urn : ''

  if (type.includes('kubernetes:apps/v1:Deployment')) {
    const key = urn || JSON.stringify(object).slice(0, 200)
    if (!seen.has(key)) {
      seen.add(key)
      const state =
        (object.newState as Record<string, unknown> | undefined) ??
        (object.state as Record<string, unknown> | undefined) ??
        object

      out.push((state?.inputs as unknown) ?? state)
    }
  }

  for (const child of Object.values(object)) {
    if (Array.isArray(child)) {
      for (const item of child) findDeploymentInputs(item, seen, out)
    } else if (child && typeof child === 'object') {
      findDeploymentInputs(child, seen, out)
    }
  }
}

function deploymentMonthlyUsd(
  inputs: any,
  rates: PlanCostRates
): number {
  const spec = inputs?.spec ?? {}
  const replicas = Number(spec.replicas ?? 3)
  const containers = spec?.template?.spec?.containers ?? []

  let cpu = 0
  let memory = 0

  for (const container of containers) {
    const requests = container?.resources?.requests ?? {}
    cpu += parseCpu(requests.cpu)
    memory += parseMemoryGiB(requests.memory)
  }

  if (cpu <= 0) cpu = 0.05
  if (memory <= 0) memory = 96 / 1024

  return replicas * rates.hoursPerMonth * (
    cpu * rates.cpuPerVcpuHour +
    memory * rates.memoryPerGiBHour
  )
}

export function estimatePlanMonthlyUsd(
  text: string,
  rates: PlanCostRates = HW32_RATES
): number {
  const parsed = parsePlan(text)
  const deployments: unknown[] = []
  const seen = new Set<string>()

  for (const item of parsed) {
    findDeploymentInputs(item, seen, deployments)
  }

  if (
    deployments.length === 0 &&
    text.includes('kubernetes:apps/v1:Deployment')
  ) {
    deployments.push({})
  }

  const total = deployments.reduce<number>(
    (sum, item) => sum + deploymentMonthlyUsd(item, rates),
    0
  )

  return Math.round(total * 100) / 100
}
