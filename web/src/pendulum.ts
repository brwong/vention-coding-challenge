import type { Lifecycle, PendulumConfig } from './services/nodeState'

// Matches the nodes: every hinge sits at y = 0 and positive y points down,
// which is also SVG's orientation.
export const HINGE_Y = 0

export interface Point {
  x: number
  y: number
}

/** Radius of a unit-density sphere, where mass equals volume. */
export function bobRadius(mass: number): number {
  return Math.cbrt((3 * mass) / (4 * Math.PI))
}

export function bobPosition(hingeX: number, length: number, angle: number): Point {
  return {
    x: hingeX + length * Math.sin(angle),
    y: HINGE_Y + length * Math.cos(angle),
  }
}

// Mirrors the nodes' COLLISION_MARGIN: bobs this close count as touching.
export const COLLISION_MARGIN = 1

/**
 * True when two pendulums would already be colliding at their initial angles,
 * using the nodes' collision rule. Every start, reset and restart returns the
 * bobs there, so such a pair would collide again the moment it swings.
 */
export function startsOverlapping(a: PendulumConfig, b: PendulumConfig): boolean {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180
  const p1 = bobPosition(a.x, a.length, toRad(a.angle))
  const p2 = bobPosition(b.x, b.length, toRad(b.angle))
  const distance = Math.hypot(p1.x - p2.x, p1.y - p2.y)
  return distance <= bobRadius(a.mass) + bobRadius(b.mass) + COLLISION_MARGIN
}

export const LIFECYCLE_COLORS: Record<Lifecycle, string> = {
  ready: '#64748b',
  running: '#16a34a',
  paused: '#ca8a04',
  stopped: '#dc2626',
  restarting: '#ea580c',
}

export const UNREACHABLE_COLOR = '#94a3b8'

// A stroke pattern per lifecycle, so the state doesn't depend on color alone.
export const LIFECYCLE_DASH: Record<Lifecycle, string | undefined> = {
  ready: undefined,
  running: undefined,
  paused: '4 3',
  stopped: '1 3',
  restarting: '6 2 1 2',
}

const NODE_COLORS = ['#2563eb', '#9333ea', '#0891b2', '#db2777', '#4f46e5', '#0d9488']

/** A stable color per node, so a pendulum keeps its color across rescans. */
export function nodeColor(port: number): string {
  return NODE_COLORS[port % NODE_COLORS.length]
}

export type ConfigField = 'x' | 'length' | 'mass' | 'angle'

// Mirrors the nodes' own limits so the form can reject values before sending
// them; the node still validates every PUT /config.
export const CONFIG_LIMITS: Record<ConfigField, { min: number; max: number }> = {
  x: { min: -Infinity, max: Infinity },
  length: { min: 10, max: 200 },
  mass: { min: 35, max: 34000 },
  angle: { min: -180, max: 180 },
}

// Wind (see docs/bonus-wind.md). Nodes accept up to 10000 cm/s, but the UI
// only exposes the suggested slider range, where the default bob's lean stays
// visible without being extreme.
export const DEFAULT_AIR_DENSITY = 0.001225 // g/cm³ (1.225 kg/m³)
export const DEFAULT_DRAG_COEFFICIENT = 0.47
export const WIND_SPEED_LIMITS = { min: 0, max: 5000 } // cm/s (0-50 m/s)
