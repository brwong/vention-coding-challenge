import { type FormEvent, useState } from 'react'
import { type ConfigDraft, draftText, fieldError, resolveDraft } from '../configDraft'
import { CONFIG_LIMITS, type ConfigField } from '../pendulum'
import type { PendulumConfig } from '../services/nodeState'

// x has no limits, so it gets no slider.
const FIELDS: { field: ConfigField; label: string; slider: boolean }[] = [
  { field: 'x', label: 'Hinge x', slider: false },
  { field: 'length', label: 'Length', slider: true },
  { field: 'mass', label: 'Mass', slider: true },
  { field: 'angle', label: 'Initial angle (°)', slider: true },
]

interface Props {
  nodeId: string
  currentConfig: PendulumConfig
  draft: ConfigDraft
  onDraftChange: (draft: ConfigDraft) => void
  onApply: (config: PendulumConfig) => Promise<void>
}

export function NodeConfigForm({ nodeId, currentConfig, draft, onDraftChange, onApply }: Props) {
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string>()

  const text = (field: ConfigField) => draftText(currentConfig, draft, field)
  const errors = FIELDS.map(({ field }) => fieldError(field, text(field)))
  const dirty = Object.keys(draft).length > 0
  const valid = errors.every((message) => message === undefined)
  const resolved = resolveDraft(currentConfig, draft)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!valid || applying) return
    setApplying(true)
    setError(undefined)
    try {
      await onApply(resolved)
      onDraftChange({})
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setApplying(false)
    }
  }

  const setField = (field: ConfigField, value: string) => onDraftChange({ ...draft, [field]: value })

  return (
    <form className="config-form" onSubmit={handleSubmit} aria-label={`Configure ${nodeId}`}>
      <h2>{nodeId}</h2>
      {FIELDS.map(({ field, label, slider }, i) => {
        const id = `${nodeId}-${field}`
        const { min, max } = CONFIG_LIMITS[field]
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
              onChange={(event) => setField(field, event.target.value)}
            />
            {slider && (
              <input
                type="range"
                min={min}
                max={max}
                value={resolved[field]}
                aria-label={`${label} slider`}
                onChange={(event) => setField(field, event.target.value)}
              />
            )}
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
        <button type="button" disabled={!dirty || applying} onClick={() => onDraftChange({})}>
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
