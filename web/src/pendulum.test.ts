import { describe, expect, it } from 'vitest'
import { bobRadius, startsOverlapping } from './pendulum'

const base = { x: 0, length: 100, mass: 4200, angle: 0 }

describe('startsOverlapping', () => {
  it('is false for the default spacing', () => {
    expect(startsOverlapping(base, { ...base, x: 100 })).toBe(false)
  })

  it('is true for bobs at the same spot', () => {
    expect(startsOverlapping(base, { ...base })).toBe(true)
  })

  it('counts bobs within the collision margin as touching', () => {
    const touching = 2 * bobRadius(base.mass) + 1
    expect(startsOverlapping(base, { ...base, x: touching })).toBe(true)
    expect(startsOverlapping(base, { ...base, x: touching + 0.01 })).toBe(false)
  })

  it('uses the initial angles in degrees', () => {
    // Swung 30° toward each other, bobs 100 apart hanging meet near the middle.
    expect(startsOverlapping({ ...base, angle: 30 }, { ...base, x: 100, angle: -30 })).toBe(true)
    expect(startsOverlapping({ ...base, angle: -30 }, { ...base, x: 100, angle: 30 })).toBe(false)
  })

  it('accounts for mass through the bob radius', () => {
    const apart = { ...base, x: 20 }
    expect(startsOverlapping(base, apart)).toBe(true)
    expect(startsOverlapping({ ...base, mass: 35 }, { ...apart, mass: 35 })).toBe(false)
  })
})
