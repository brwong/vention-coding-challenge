import { type FormEvent, useState } from 'react'
import { CONFIG_LIMITS, type ConfigField } from '../pendulum'
import type { PendulumConfig } from '../services/nodeState'

/** Text typed into each field that differs from the node's config; untouched fields are absent. */
export type ConfigDraft = Partial<Record<ConfigField, string>>

const FIELDS: { field: ConfigField; label: string }[] = [
  { field: 'x', label: 'Hinge x' },
  { field: 'length', label: 'Length' },
  { field: 'mass', label: 'Mass' },
  { field: 'angle', label: 'Initial angle (°)' },
]

function fieldError(field: ConfigField, text: string): string | undefined {
  if (text.trim() === '') return 'Required'
  const value = Number(text)
  if (!Number.isFinite(value)) return 'Must be a number'
  const { min, max } = CONFIG_LIMITS[field]
  if (value < min || value > max) return `Must be between ${min} and ${max}`
  return undefined
}

interface Props {
  nodeId: string
  currentConfig: PendulumConfig
  onApply: (config: PendulumConfig) => Promise<void>
}

export function NodeConfigForm({ nodeId, currentConfig, onApply }: Props) {
  const [draft, setDraft] = useState<ConfigDraft>({})
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string>()

  const text = (field: ConfigField) => draft[field] ?? String(currentConfig[field])
  const errors = FIELDS.map(({ field }) => fieldError(field, text(field)))
  const dirty = Object.keys(draft).length > 0
  const valid = errors.every((message) => message === undefined)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!valid || applying) return
    const config: PendulumConfig = {
      x: Number(text('x')),
      length: Number(text('length')),
      mass: Number(text('mass')),
      angle: Number(text('angle')),
    }
    setApplying(true)
    setError(undefined)
    try {
      await onApply(config)
      setDraft({})
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setApplying(false)
    }
  }

  return (
    <form className="config-form" onSubmit={handleSubmit} aria-label={`Configure ${nodeId}`}>
      <h2>{nodeId}</h2>
      {FIELDS.map(({ field, label }, i) => {
        const id = `${nodeId}-${field}`
        return (
          <div key={field} className="field">
            <label htmlFor={id}>{label}</label>
            <input
              id={id}
              type="number"
              step="any"
              value={text(field)}
              aria-invalid={errors[i] !== undefined}
              aria-describedby={errors[i] ? `${id}-error` : undefined}
              onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
            />
            {errors[i] && (
              <span id={`${id}-error`} className="field-error">
                {errors[i]}
              </span>
            )}
          </div>
        )
      })}
      <div className="form-actions">
        <button type="submit" disabled={!dirty || !valid || applying}>
          {applying ? 'Applying…' : 'Apply'}
        </button>
        <button type="button" disabled={!dirty || applying} onClick={() => setDraft({})}>
          Reset
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}
