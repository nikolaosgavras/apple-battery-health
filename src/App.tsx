import { type ChangeEvent, useState } from 'react'
import samplePlist from './sampleData.md?raw'
import './App.css'

type PlistValue = string | number | boolean | null | PlistValue[] | PlistMap

interface PlistMap {
  [key: string]: PlistValue
}

interface BatteryMetrics {
  cycleCount: number | null
  designCapacityMah: number | null
  fullChargeCapacityMah: number | null
  currentCapacityMah: number | null
  healthPercent: number | null
  healthBand: string
  stateOfChargePercent: number | null
  temperatureC: number | null
  voltageV: number | null
  currentMa: number | null
  timeRemainingMinutes: number | null
  isCharging: boolean | null
  externalConnected: boolean | null
  adapterWatts: number | null
  updatedAtLocal: string | null
}

interface AnalysisResult {
  metrics: BatteryMetrics | null
  error: string | null
}

interface MetricCardProps {
  label: string
  value: string
  hint?: string
  tone?: 'neutral' | 'good' | 'warning' | 'critical'
}

const isPlistMap = (value: PlistValue | undefined): value is PlistMap =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const getElementChildren = (node: ParentNode): Element[] =>
  Array.from(node.children)

const parsePlistValue = (node: Element): PlistValue => {
  switch (node.tagName) {
    case 'dict': {
      const result: PlistMap = {}
      const children = getElementChildren(node)

      for (let index = 0; index < children.length; index += 1) {
        const keyNode = children[index]
        if (keyNode.tagName !== 'key') {
          continue
        }

        const key = keyNode.textContent?.trim() ?? ''
        const valueNode = children[index + 1]
        if (!key || !valueNode) {
          continue
        }

        result[key] = parsePlistValue(valueNode)
        index += 1
      }

      return result
    }
    case 'array':
      return getElementChildren(node).map((child) => parsePlistValue(child))
    case 'integer':
    case 'real': {
      const parsed = Number(node.textContent?.trim() ?? '')
      return Number.isFinite(parsed) ? parsed : 0
    }
    case 'true':
      return true
    case 'false':
      return false
    case 'string':
    case 'data':
    case 'date':
      return node.textContent?.trim() ?? ''
    default:
      return node.textContent?.trim() ?? ''
  }
}

const parsePlist = (input: string): PlistMap => {
  const xml = new DOMParser().parseFromString(input, 'application/xml')
  if (xml.querySelector('parsererror')) {
    throw new Error('Invalid XML format. Please provide a valid plist file.')
  }

  const plistNode = xml.querySelector('plist')
  if (!plistNode) {
    throw new Error('Could not find a <plist> root element in the input.')
  }

  const rootValueNode = getElementChildren(plistNode)[0]
  if (!rootValueNode) {
    throw new Error('The plist does not contain a readable payload.')
  }

  const parsed = parsePlistValue(rootValueNode)
  if (!isPlistMap(parsed)) {
    throw new Error('Top-level plist payload must be a dictionary.')
  }

  return parsed
}

const getPathValue = (root: PlistMap, path: string[]): PlistValue | undefined => {
  let current: PlistValue = root

  for (const segment of path) {
    if (!isPlistMap(current)) {
      return undefined
    }

    current = current[segment]
    if (typeof current === 'undefined') {
      return undefined
    }
  }

  return current
}

const readNumber = (root: PlistMap, paths: string[][]): number | null => {
  for (const path of paths) {
    const value = getPathValue(root, path)
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }

    if (typeof value === 'string') {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) {
        return parsed
      }
    }
  }

  return null
}

const readBoolean = (root: PlistMap, paths: string[][]): boolean | null => {
  for (const path of paths) {
    const value = getPathValue(root, path)
    if (typeof value === 'boolean') {
      return value
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase()
      if (normalized === 'true') {
        return true
      }

      if (normalized === 'false') {
        return false
      }
    }
  }

  return null
}

const toTemperatureC = (rawValue: number | null): number | null => {
  if (rawValue === null) {
    return null
  }

  return rawValue > 150 ? rawValue / 100 : rawValue
}

const toVoltageV = (rawValue: number | null): number | null => {
  if (rawValue === null) {
    return null
  }

  return rawValue > 20 ? rawValue / 1000 : rawValue
}

const toStateOfChargePercent = (rawValue: number | null): number | null => {
  if (rawValue === null) {
    return null
  }

  return rawValue > 100 ? rawValue / 100 : rawValue
}

const healthBandFromPercent = (percent: number | null): string => {
  if (percent === null) {
    return 'unknown'
  }

  if (percent >= 90) {
    return 'excellent'
  }

  if (percent >= 80) {
    return 'good'
  }

  if (percent >= 70) {
    return 'fair'
  }

  return 'service soon'
}

const extractBatteryMetrics = (parsedRoot: PlistMap): BatteryMetrics => {
  const ioRegistry = isPlistMap(parsedRoot.IORegistry)
    ? parsedRoot.IORegistry
    : parsedRoot

  const designCapacityMah = readNumber(ioRegistry, [
    ['DesignCapacity'],
    ['BatteryData', 'DesignCapacity'],
  ])
  const fullChargeCapacityMah = readNumber(ioRegistry, [
    ['NominalChargeCapacity'],
    ['AppleRawMaxCapacity'],
    ['BatteryData', 'FccComp1'],
    ['LPEMData', 'MaxCapacity'],
  ])
  const currentCapacityMah = readNumber(ioRegistry, [
    ['AppleRawCurrentCapacity'],
    ['LPEMData', 'CurrentCapacity'],
    ['BatteryData', 'TrueRemainingCapacity'],
  ])
  const cycleCount = readNumber(ioRegistry, [
    ['CycleCount'],
    ['BatteryData', 'CycleCount'],
  ])

  const healthPercent =
    designCapacityMah && fullChargeCapacityMah
      ? (fullChargeCapacityMah / designCapacityMah) * 100
      : null

  const stateOfChargePercent = toStateOfChargePercent(
    readNumber(ioRegistry, [
      ['CurrentCapacity'],
      ['BatteryData', 'StateOfCharge'],
      ['LPEMData', 'StateOfCharge'],
    ]),
  )

  const temperatureC = toTemperatureC(
    readNumber(ioRegistry, [['Temperature'], ['VirtualTemperature']]),
  )
  const voltageV = toVoltageV(
    readNumber(ioRegistry, [
      ['Voltage'],
      ['BatteryData', 'Voltage'],
      ['AppleRawBatteryVoltage'],
    ]),
  )

  const updateEpochSeconds = readNumber(ioRegistry, [['UpdateTime']])
  const updatedAtLocal =
    updateEpochSeconds && updateEpochSeconds > 0
      ? new Date(updateEpochSeconds * 1000).toLocaleString()
      : null

  return {
    cycleCount,
    designCapacityMah,
    fullChargeCapacityMah,
    currentCapacityMah,
    healthPercent,
    healthBand: healthBandFromPercent(healthPercent),
    stateOfChargePercent,
    temperatureC,
    voltageV,
    currentMa: readNumber(ioRegistry, [['InstantAmperage'], ['Amperage']]),
    timeRemainingMinutes: readNumber(ioRegistry, [['TimeRemaining'], ['AvgTimeToEmpty']]),
    isCharging: readBoolean(ioRegistry, [['IsCharging']]),
    externalConnected: readBoolean(ioRegistry, [
      ['ExternalConnected'],
      ['AppleRawExternalConnected'],
    ]),
    adapterWatts: readNumber(ioRegistry, [['AdapterDetails', 'Watts']]),
    updatedAtLocal,
  }
}

const analyzePlist = (payload: string): AnalysisResult => {
  if (!payload.trim()) {
    return {
      metrics: null,
      error: 'Paste or upload plist text first, then run analysis.',
    }
  }

  try {
    const parsed = parsePlist(payload)
    return {
      metrics: extractBatteryMetrics(parsed),
      error: null,
    }
  } catch (error) {
    return {
      metrics: null,
      error:
        error instanceof Error
          ? error.message
          : 'Failed to parse plist data. Please verify the file content.',
    }
  }
}

const formatMetric = (
  value: number | null,
  options?: { digits?: number; suffix?: string },
): string => {
  if (value === null || !Number.isFinite(value)) {
    return 'n/a'
  }

  const digits = options?.digits ?? 0
  const suffix = options?.suffix ?? ''
  return `${value.toFixed(digits)}${suffix}`
}

const formatTimeRemaining = (minutes: number | null): string => {
  if (minutes === null || minutes <= 0) {
    return 'n/a'
  }

  const rounded = Math.round(minutes)
  const hours = Math.floor(rounded / 60)
  const mins = rounded % 60
  return `${hours}h ${mins}m`
}

const batteryHealthTone = (
  percent: number | null,
): MetricCardProps['tone'] => {
  if (percent === null) {
    return 'neutral'
  }

  if (percent >= 90) {
    return 'good'
  }

  if (percent >= 80) {
    return 'warning'
  }

  return 'critical'
}

const MetricCard = ({
  label,
  value,
  hint,
  tone = 'neutral',
}: MetricCardProps) => (
  <article className={`metric-card metric-${tone}`}>
    <p className="metric-label">{label}</p>
    <p className="metric-value">{value}</p>
    {hint ? <p className="metric-hint">{hint}</p> : null}
  </article>
)

export const App = () => {
  const [rawInput, setRawInput] = useState('')
  const [metrics, setMetrics] = useState<BatteryMetrics | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoadingFile, setIsLoadingFile] = useState(false)

  const runAnalysis = (payload: string) => {
    const result = analyzePlist(payload)
    setMetrics(result.metrics)
    setError(result.error)
  }

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    try {
      setIsLoadingFile(true)
      const content = await file.text()
      setRawInput(content)
      runAnalysis(content)
    } catch {
      setError('Unable to read the selected file. Please try another file.')
      setMetrics(null)
    } finally {
      setIsLoadingFile(false)
    }
  }

  return (
    <main className="app-shell">
      <header className="page-header">
        <p className="eyebrow">Battery Diagnostics</p>
        <h1>Apple Battery Health Analyzer</h1>
        <p>
          Upload or paste your plist payload to extract cycle count, battery
          health, charging state, and core battery diagnostics.
        </p>
      </header>

      <section className="panel">
        <div className="controls-row">
          <label className="file-upload">
            <input
              type="file"
              accept=".plist,.xml,.txt,.md"
              onChange={handleFileUpload}
            />
            {isLoadingFile ? 'Reading file...' : 'Upload plist file'}
          </label>

          <button type="button" onClick={() => runAnalysis(rawInput)}>
            Analyze text
          </button>

          <button
            type="button"
            className="ghost"
            onClick={() => {
              setRawInput(samplePlist)
              runAnalysis(samplePlist)
            }}
          >
            Load bundled sample
          </button>
        </div>

        <label className="input-label" htmlFor="plist-input">
          plist input
        </label>
        <textarea
          id="plist-input"
          value={rawInput}
          onChange={(event) => setRawInput(event.target.value)}
          spellCheck={false}
          rows={16}
          placeholder="Paste your battery plist XML here..."
        />

        {error ? <p className="error-box">{error}</p> : null}
      </section>

      {metrics ? (
        <section className="panel">
          <h2>Important battery metrics</h2>
          <div className="metrics-grid">
            <MetricCard
              label="Cycle count"
              value={formatMetric(metrics.cycleCount)}
              hint="Total full equivalent charge cycles"
            />
            <MetricCard
              label="Battery health"
              value={formatMetric(metrics.healthPercent, {
                digits: 1,
                suffix: '%',
              })}
              hint={`Health band: ${metrics.healthBand}`}
              tone={batteryHealthTone(metrics.healthPercent)}
            />
            <MetricCard
              label="State of charge"
              value={formatMetric(metrics.stateOfChargePercent, {
                digits: 1,
                suffix: '%',
              })}
              hint="Current battery level"
            />
            <MetricCard
              label="Current capacity"
              value={formatMetric(metrics.currentCapacityMah, {
                suffix: ' mAh',
              })}
            />
            <MetricCard
              label="Full charge capacity"
              value={formatMetric(metrics.fullChargeCapacityMah, {
                suffix: ' mAh',
              })}
            />
            <MetricCard
              label="Design capacity"
              value={formatMetric(metrics.designCapacityMah, {
                suffix: ' mAh',
              })}
            />
            <MetricCard
              label="Voltage"
              value={formatMetric(metrics.voltageV, {
                digits: 3,
                suffix: ' V',
              })}
            />
            <MetricCard
              label="Temperature"
              value={formatMetric(metrics.temperatureC, {
                digits: 1,
                suffix: ' C',
              })}
            />
            <MetricCard
              label="Current"
              value={formatMetric(metrics.currentMa, {
                suffix: ' mA',
              })}
            />
            <MetricCard
              label="Time remaining"
              value={formatTimeRemaining(metrics.timeRemainingMinutes)}
              hint="Estimated by iOS power model"
            />
            <MetricCard
              label="Charging"
              value={
                metrics.isCharging === null
                  ? 'n/a'
                  : metrics.isCharging
                    ? 'Yes'
                    : 'No'
              }
            />
            <MetricCard
              label="External power"
              value={
                metrics.externalConnected === null
                  ? 'n/a'
                  : metrics.externalConnected
                    ? 'Connected'
                    : 'Not connected'
              }
              hint={
                metrics.adapterWatts !== null
                  ? `Adapter: ${metrics.adapterWatts} W`
                  : undefined
              }
            />
          </div>

          <p className="footer-meta">
            Last update: {metrics.updatedAtLocal ?? 'n/a'}
          </p>
        </section>
      ) : null}
    </main>
  )
}

export default App
