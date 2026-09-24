import { describe, expect, it } from "vitest";
import { COLLISION_MARGIN, DEFAULT_MASS, DT, GRAVITY, MAX_MASS, MIN_MASS, PHYSICS_HZ } from "./constants";
import {
  type Bob,
  type PendulumState,
  calculateBobRadius,
  checkCollision,
  createPendulum,
  getPosition,
  normalizeAngle,
  updatePendulum,
} from "./physics";

const deg = (degrees: number) => (degrees * Math.PI) / 180;

function run(state: PendulumState, length: number, steps: number): PendulumState {
  for (let i = 0; i < steps; i++) state = updatePendulum(state, length);
  return state;
}

// Energy per unit mass, with the lowest point of the swing as zero.
function energy(state: PendulumState, length: number): number {
  const kinetic = 0.5 * (length * state.angularVelocity) ** 2;
  const potential = GRAVITY * length * (1 - Math.cos(state.angle));
  return kinetic + potential;
}

describe("normalizeAngle", () => {
  // ±π are the same orientation; the result may use either representation.
  const expectStraightUp = (angle: number) => expect(Math.abs(angle)).toBeCloseTo(Math.PI, 12);

  it("leaves angles inside the range unchanged", () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(Math.PI / 2)).toBeCloseTo(Math.PI / 2, 12);
    expect(normalizeAngle(-Math.PI / 2)).toBeCloseTo(-Math.PI / 2, 12);
  });

  it("maps ±π to straight up", () => {
    expectStraightUp(normalizeAngle(Math.PI));
    expectStraightUp(normalizeAngle(-Math.PI));
  });

  it("wraps whole turns away", () => {
    expect(normalizeAngle(2 * Math.PI)).toBeCloseTo(0, 12);
    expect(normalizeAngle(-2 * Math.PI)).toBeCloseTo(0, 12);
    expect(normalizeAngle((5 * Math.PI) / 2)).toBeCloseTo(Math.PI / 2, 12);
    expect(normalizeAngle((-5 * Math.PI) / 2)).toBeCloseTo(-Math.PI / 2, 12);
    expectStraightUp(normalizeAngle(3 * Math.PI));
    expectStraightUp(normalizeAngle(-3 * Math.PI));
  });

  it("always returns a value in [-π, π]", () => {
    for (let angle = -20; angle <= 20; angle += 0.37) {
      const result = normalizeAngle(angle);
      expect(result).toBeGreaterThanOrEqual(-Math.PI);
      expect(result).toBeLessThanOrEqual(Math.PI);
      expect(Math.sin(result)).toBeCloseTo(Math.sin(angle), 10);
      expect(Math.cos(result)).toBeCloseTo(Math.cos(angle), 10);
    }
  });
});

describe("updatePendulum", () => {
  const length = 100;

  it("swings a displaced pendulum back toward vertical", () => {
    const next = updatePendulum(createPendulum(20), length);
    expect(next.angularAcceleration).toBeLessThan(0);
    expect(next.angularVelocity).toBeLessThan(0);
    expect(next.angle).toBeLessThan(deg(20));

    const mirrored = updatePendulum(createPendulum(-20), length);
    expect(mirrored.angle).toBeCloseTo(-next.angle, 12);
  });

  it("uses semi-implicit Euler: the new velocity moves the angle", () => {
    const start = createPendulum(45);
    const next = updatePendulum(start, length);
    const acceleration = -(GRAVITY / length) * Math.sin(start.angle);
    expect(next.angularAcceleration).toBeCloseTo(acceleration, 12);
    expect(next.angularVelocity).toBeCloseTo(acceleration * DT, 12);
    expect(next.angle).toBeCloseTo(start.angle + acceleration * DT * DT, 12);
  });

  it("keeps the angle normalized and changing over 10 steps from 45°", () => {
    let state = createPendulum(45);
    for (let i = 0; i < 10; i++) {
      const next = updatePendulum(state, length);
      expect(next.angle).not.toBe(state.angle);
      expect(Math.abs(next.angle)).toBeLessThanOrEqual(Math.PI);
      state = next;
    }
  });

  it("has negative angular velocity after swinging past vertical", () => {
    let state = createPendulum(30);
    while (state.angle > 0) state = updatePendulum(state, length);
    expect(state.angle).toBeLessThan(0);
    expect(state.angularVelocity).toBeLessThan(0);
  });

  it("oscillates with roughly constant energy instead of drifting or exploding", () => {
    // Semi-implicit Euler lets energy wobble slightly but not drift.
    let state = createPendulum(60);
    const initial = energy(state, length);
    let minAngle = Infinity;
    let maxAngle = -Infinity;
    for (let i = 0; i < 20 * PHYSICS_HZ; i++) {
      state = updatePendulum(state, length);
      minAngle = Math.min(minAngle, state.angle);
      maxAngle = Math.max(maxAngle, state.angle);
      expect(Math.abs(energy(state, length) - initial) / initial).toBeLessThan(0.05);
    }
    // Swings to both sides, reaching close to the starting amplitude.
    expect(maxAngle).toBeGreaterThan(deg(58));
    expect(minAngle).toBeLessThan(deg(-58));
  });

  it("goes over the top instead of stopping when started just below it", () => {
    const state = run({ angle: deg(179), angularVelocity: 0, angularAcceleration: 0 }, length, 400);
    expect(Number.isFinite(state.angle)).toBe(true);
    expect(Math.abs(state.angle)).toBeLessThanOrEqual(Math.PI);
  });

  it("advances 1/60 s per step, so 60 steps are one second of motion", () => {
    expect(DT).toBe(1 / 60);
    // A small swing has period 2π·√(L/g) ≈ 2.006 s, so after one second it is
    // almost exactly on the opposite side.
    const period = 2 * Math.PI * Math.sqrt(length / GRAVITY);
    const expected = deg(5) * Math.cos((2 * Math.PI * 1) / period);
    const state = run(createPendulum(5), length, 60);
    expect(state.angle).toBeCloseTo(expected, 3);
  });

  it("swings faster on a shorter rod", () => {
    const short = run(createPendulum(10), 50, 10);
    const long = run(createPendulum(10), 200, 10);
    expect(short.angle).toBeLessThan(long.angle);
  });

  it("stays at rest when hanging straight down", () => {
    const state = run(createPendulum(0), length, 60);
    expect(state.angle).toBe(0);
    expect(state.angularVelocity).toBe(0);
  });
});

describe("calculateBobRadius", () => {
  it("gives the radius of a unit-density sphere", () => {
    // V = m = 4/3·π·r³
    const radius = calculateBobRadius(1);
    expect((4 / 3) * Math.PI * radius ** 3).toBeCloseTo(1, 12);
    expect(radius).toBeCloseTo(0.6204, 4);
  });

  it("gives about 10 for the default mass and about 2 to 20 across the limits", () => {
    expect(calculateBobRadius(DEFAULT_MASS)).toBeCloseTo(10, 0);
    expect(calculateBobRadius(MIN_MASS)).toBeCloseTo(2, 0);
    expect(calculateBobRadius(MAX_MASS)).toBeCloseTo(20, 0);
  });

  it("doubles the radius for eight times the mass", () => {
    expect(calculateBobRadius(8 * 500)).toBeCloseTo(2 * calculateBobRadius(500), 10);
  });

  it("scales with the cube root of mass and is always positive", () => {
    for (const mass of [MIN_MASS, 100, 1000, DEFAULT_MASS, MAX_MASS]) {
      const radius = calculateBobRadius(mass);
      expect(radius).toBeGreaterThan(0);
      expect(radius / Math.cbrt(mass)).toBeCloseTo(calculateBobRadius(1), 10);
    }
  });
});

describe("getPosition", () => {
  it("hangs the bob straight down at angle 0 (positive y is down)", () => {
    expect(getPosition({ angle: 0 }, 50, 0, 100)).toEqual({ x: 50, y: 100 });
  });

  it("moves the bob right for positive angles", () => {
    const position = getPosition({ angle: Math.PI / 2 }, 50, 0, 100);
    expect(position.x).toBeCloseTo(150, 10);
    expect(position.y).toBeCloseTo(0, 10);
  });
});

describe("checkCollision", () => {
  const radius = calculateBobRadius(DEFAULT_MASS);

  // Both bobs hang straight down from the same height, so the distance
  // between them is the distance between their hinges.
  function bobsApart(distance: number, massA = DEFAULT_MASS, massB = DEFAULT_MASS): [Bob, Bob] {
    const bob = (x: number, mass: number): Bob => ({ angle: 0, anchor: { x, y: 0 }, length: 100, mass });
    return [bob(0, massA), bob(distance, massB)];
  }

  it("detects bobs in the same place", () => {
    expect(checkCollision(...bobsApart(0))).toBe(true);
  });

  it("ignores bobs far apart", () => {
    expect(checkCollision(...bobsApart(100))).toBe(false);
  });

  it("detects bobs that exactly touch", () => {
    expect(checkCollision(...bobsApart(2 * radius))).toBe(true);
  });

  it("detects bobs within the margin", () => {
    expect(checkCollision(...bobsApart(2 * radius + 0.5 * COLLISION_MARGIN))).toBe(true);
  });

  it("ignores bobs just outside the margin", () => {
    expect(checkCollision(...bobsApart(2 * radius + 1.5 * COLLISION_MARGIN))).toBe(false);
  });

  it("uses each bob's own radius", () => {
    const small = calculateBobRadius(MIN_MASS);
    const large = calculateBobRadius(MAX_MASS);
    const threshold = small + large + COLLISION_MARGIN;
    expect(checkCollision(...bobsApart(threshold - 0.1, MIN_MASS, MAX_MASS))).toBe(true);
    expect(checkCollision(...bobsApart(threshold + 0.1, MIN_MASS, MAX_MASS))).toBe(false);
    // Two small bobs at the same distance are well clear of each other.
    expect(checkCollision(...bobsApart(threshold - 0.1, MIN_MASS, MIN_MASS))).toBe(false);
  });

  it("is symmetric", () => {
    const [a, b] = bobsApart(2 * radius + 0.5, MIN_MASS, MAX_MASS);
    expect(checkCollision(a, b)).toBe(checkCollision(b, a));
  });

  it("detects bobs that swing into each other from separate hinges", () => {
    const a: Bob = { angle: deg(30), anchor: { x: 0, y: 0 }, length: 100, mass: DEFAULT_MASS };
    const b: Bob = { angle: deg(-30), anchor: { x: 100, y: 0 }, length: 100, mass: DEFAULT_MASS };
    expect(checkCollision(a, b)).toBe(true);
    expect(checkCollision({ ...a, angle: 0 }, { ...b, angle: 0 })).toBe(false);
  });
});
