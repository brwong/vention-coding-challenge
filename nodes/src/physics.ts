import { COLLISION_MARGIN, DT, GRAVITY } from "./constants";

export interface PendulumState {
  angle: number; // radians, normalized to [-π, π]
  angularVelocity: number; // rad/s
  angularAcceleration: number; // rad/s²
}

export interface Point {
  x: number;
  y: number;
}

/** Maps any angle to its equivalent in [-π, π). Angular velocity is unaffected. */
export function normalizeAngle(angle: number): number {
  const fullTurn = 2 * Math.PI;
  return ((((angle + Math.PI) % fullTurn) + fullTurn) % fullTurn) - Math.PI;
}

// The initial angle is not normalized, so ±180° stays exactly ±π.
export function createPendulum(initialAngleDeg: number): PendulumState {
  return {
    angle: (initialAngleDeg * Math.PI) / 180,
    angularVelocity: 0,
    angularAcceleration: 0,
  };
}

/** Advances one fixed timestep using semi-implicit Euler. */
export function updatePendulum(state: PendulumState, length: number): PendulumState {
  const angularAcceleration = -(GRAVITY / length) * Math.sin(state.angle);
  const angularVelocity = state.angularVelocity + angularAcceleration * DT;
  const angle = normalizeAngle(state.angle + angularVelocity * DT);
  return { angle, angularVelocity, angularAcceleration };
}

/** Radius of a unit-density sphere, where mass equals volume. */
export function calculateBobRadius(mass: number): number {
  return Math.cbrt((3 * mass) / (4 * Math.PI));
}

/** Bob center in coordinates where positive y points downward. */
export function getPosition(
  state: Pick<PendulumState, "angle">,
  anchorX: number,
  anchorY: number,
  length: number,
): Point {
  return {
    x: anchorX + length * Math.sin(state.angle),
    y: anchorY + length * Math.cos(state.angle),
  };
}

/** Everything needed to place a bob and size it. */
export interface Bob {
  angle: number; // radians
  anchor: Point; // hinge position
  length: number;
  mass: number;
}

/** True when two bobs touch or come within COLLISION_MARGIN of each other. */
export function checkCollision(a: Bob, b: Bob): boolean {
  const p1 = getPosition({ angle: a.angle }, a.anchor.x, a.anchor.y, a.length);
  const p2 = getPosition({ angle: b.angle }, b.anchor.x, b.anchor.y, b.length);
  const distance = Math.hypot(p1.x - p2.x, p1.y - p2.y);
  return distance <= calculateBobRadius(a.mass) + calculateBobRadius(b.mass) + COLLISION_MARGIN;
}
