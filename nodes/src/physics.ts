import { COLLISION_MARGIN, DT, GRAVITY } from "./constants";
import { type WindOn, type WindState, NO_WIND } from "./wind";

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

/** Radius of a unit-density sphere, where mass equals volume. */
export function calculateBobRadius(mass: number): number {
  return Math.cbrt((3 * mass) / (4 * Math.PI));
}

/**
 * Angular acceleration contributed by wind drag (see docs/bonus-wind.md). Uses
 * relative velocity (wind minus the bob's own Cartesian velocity) so the drag
 * force is proportional to relative speed squared, and projects it onto the
 * pendulum's tangential direction to convert it to angular acceleration.
 */
export function calculateWindAcceleration(
  state: Pick<PendulumState, "angle" | "angularVelocity">,
  length: number,
  mass: number,
  wind: WindOn,
): number {
  const radius = calculateBobRadius(mass);
  const area = Math.PI * radius ** 2;

  const bobVelocity = {
    x: length * Math.cos(state.angle) * state.angularVelocity,
    y: -length * Math.sin(state.angle) * state.angularVelocity,
  };
  const windVelocity = {
    x: wind.direction === "right" ? wind.speed : -wind.speed,
    y: 0,
  };
  const relativeVelocity = {
    x: windVelocity.x - bobVelocity.x,
    y: windVelocity.y - bobVelocity.y,
  };
  const relativeSpeed = Math.hypot(relativeVelocity.x, relativeVelocity.y);

  const dragScale = 0.5 * wind.airDensity * wind.dragCoefficient * area * relativeSpeed;
  const windForce = {
    x: dragScale * relativeVelocity.x,
    y: dragScale * relativeVelocity.y,
  };

  const tangent = { x: Math.cos(state.angle), y: -Math.sin(state.angle) };
  const tangentialForce = windForce.x * tangent.x + windForce.y * tangent.y;

  return tangentialForce / (mass * length);
}

/** Advances one fixed timestep using semi-implicit Euler. Wind is optional and off by default. */
export function updatePendulum(
  state: PendulumState,
  length: number,
  mass: number,
  wind: WindState = NO_WIND,
): PendulumState {
  const gravityAcceleration = -(GRAVITY / length) * Math.sin(state.angle);
  const windAcceleration = wind.enabled ? calculateWindAcceleration(state, length, mass, wind) : 0;
  const angularAcceleration = gravityAcceleration + windAcceleration;
  const angularVelocity = state.angularVelocity + angularAcceleration * DT;
  const angle = normalizeAngle(state.angle + angularVelocity * DT);
  return { angle, angularVelocity, angularAcceleration };
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
