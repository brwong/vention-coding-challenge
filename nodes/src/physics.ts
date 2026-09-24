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
  state: PendulumState,
  anchorX: number,
  anchorY: number,
  length: number,
): Point {
  return {
    x: anchorX + length * Math.sin(state.angle),
    y: anchorY + length * Math.cos(state.angle),
  };
}

export function checkCollision(
  state1: PendulumState,
  state2: PendulumState,
  anchor1: Point,
  anchor2: Point,
  length1: number,
  length2: number,
  mass1: number,
  mass2: number,
): boolean {
  const p1 = getPosition(state1, anchor1.x, anchor1.y, length1);
  const p2 = getPosition(state2, anchor2.x, anchor2.y, length2);
  const distance = Math.hypot(p1.x - p2.x, p1.y - p2.y);
  return distance <= calculateBobRadius(mass1) + calculateBobRadius(mass2) + COLLISION_MARGIN;
}
