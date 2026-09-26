import { WIND_SPEED_LIMITS } from '../pendulum'
import type { WindDirection } from '../services/nodeState'

export interface WindDraft {
  enabled: boolean
  direction: WindDirection
  speed: number // cm/s
}

export const OFF_WIND_DRAFT: WindDraft = { enabled: false, direction: 'right', speed: 0 }

interface ToggleProps {
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
  label: string
  // Overrides the accessible name; defaults to `label`. Use when `label` changes with state.
  ariaLabel?: string
}

function Toggle({ checked, disabled, onChange, label, ariaLabel }: ToggleProps) {
  return (
    <label className="toggle-switch">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="toggle-track" aria-hidden="true" />
      <span className="toggle-text" aria-hidden={ariaLabel !== undefined || undefined}>
        {label}
      </span>
    </label>
  )
}

interface Props {
  draft: WindDraft
  // The configuration last confirmed sent to every node, or the reset default.
  saved: WindDraft
  onChange: (draft: WindDraft) => void
  onApply: () => void
  applying: boolean
  // No active nodes to send the command to.
  disabled: boolean
}

/**
 * A global wind toggle sent to every node, distinct from per-node
 * configuration: the UI, not any node, owns the displayed wind state (see
 * docs/bonus-wind.md). Edits are draft-only until Save, which is enabled
 * only once the draft differs from what was last confirmed sent.
 */
export function WindControl({ draft, saved, onChange, onApply, applying, disabled }: Props) {
  const dirty =
    draft.enabled !== saved.enabled ||
    (draft.enabled && (draft.direction !== saved.direction || draft.speed !== saved.speed))

  return (
    <div className="wind-control">
      <Toggle
        checked={draft.enabled}
        disabled={disabled}
        onChange={(enabled) => onChange({ ...draft, enabled })}
        label="Wind"
      />
      <Toggle
        checked={draft.direction === 'right'}
        disabled={disabled || !draft.enabled}
        onChange={(checked) => onChange({ ...draft, direction: checked ? 'right' : 'left' })}
        label={draft.direction === 'right' ? 'Right' : 'Left'}
        ariaLabel="Wind direction"
      />
      <input
        type="range"
        aria-label="Wind speed"
        min={WIND_SPEED_LIMITS.min}
        max={WIND_SPEED_LIMITS.max}
        value={draft.speed}
        disabled={disabled || !draft.enabled}
        onChange={(event) => onChange({ ...draft, speed: Number(event.target.value) })}
      />
      <span className="wind-speed-value">{draft.speed} cm/s</span>
      <button type="button" disabled={disabled || applying || !dirty} onClick={onApply}>
        {applying ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}
