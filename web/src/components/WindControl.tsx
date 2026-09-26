import { WIND_SPEED_LIMITS } from '../pendulum'
import type { WindDirection } from '../services/nodeState'

export interface WindDraft {
  enabled: boolean
  direction: WindDirection
  speed: number // cm/s
}

export const OFF_WIND_DRAFT: WindDraft = { enabled: false, direction: 'right', speed: 0 }

interface Props {
  draft: WindDraft
  onChange: (draft: WindDraft) => void
  onApply: () => void
  applying: boolean
  // No active nodes to send the command to.
  disabled: boolean
}

/**
 * A global wind toggle sent to every node, distinct from per-node
 * configuration: the UI, not any node, owns the displayed wind state (see
 * docs/bonus-wind.md). Edits are draft-only until Apply, matching the
 * per-node config form's one-request-per-Apply pattern.
 */
export function WindControl({ draft, onChange, onApply, applying, disabled }: Props) {
  return (
    <div className="wind-control">
      <label className="wind-toggle">
        <input
          type="checkbox"
          checked={draft.enabled}
          disabled={disabled}
          onChange={(event) => onChange({ ...draft, enabled: event.target.checked })}
        />
        Wind
      </label>
      <select
        aria-label="Wind direction"
        value={draft.direction}
        disabled={disabled || !draft.enabled}
        onChange={(event) => onChange({ ...draft, direction: event.target.value as WindDirection })}
      >
        <option value="left">Left</option>
        <option value="right">Right</option>
      </select>
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
      <button type="button" disabled={disabled || applying} onClick={onApply}>
        {applying ? 'Applying…' : 'Apply Wind'}
      </button>
    </div>
  )
}
