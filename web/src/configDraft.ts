import { CONFIG_LIMITS, type ConfigField } from './pendulum'
import type { PendulumConfig } from './services/nodeState'

export const CONFIG_FIELDS: ConfigField[] = ['x', 'length', 'mass', 'angle']

/** Text entered for each field that differs from the node's config; untouched fields are absent. */
export type ConfigDraft = Partial<Record<ConfigField, string>>

export function draftText(config: PendulumConfig, draft: ConfigDraft, field: ConfigField): string {
  return draft[field] ?? String(config[field])
}

/** Why the text is not an acceptable value for the field, or undefined if it is. */
export function fieldError(field: ConfigField, text: string): string | undefined {
  if (text.trim() === '') return 'Required'
  const value = Number(text)
  if (!Number.isFinite(value)) return 'Must be a number'
  const { min, max } = CONFIG_LIMITS[field]
  if (value < min || value > max) return `Must be between ${min} and ${max}`
  return undefined
}

/** The config the draft describes, keeping the node's value for any field that is invalid. */
export function resolveDraft(config: PendulumConfig, draft: ConfigDraft): PendulumConfig {
  const resolved = { ...config }
  for (const field of CONFIG_FIELDS) {
    const text = draft[field]
    if (text !== undefined && fieldError(field, text) === undefined) resolved[field] = Number(text)
  }
  return resolved
}

/** Drops fields whose text matches the node's config, so an empty draft means nothing changed. */
export function pruneDraft(config: PendulumConfig, draft: ConfigDraft): ConfigDraft {
  const pruned: ConfigDraft = {}
  for (const field of CONFIG_FIELDS) {
    const text = draft[field]
    if (text !== undefined && text !== String(config[field])) pruned[field] = text
  }
  return pruned
}
