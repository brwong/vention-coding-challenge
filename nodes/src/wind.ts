import { MAX_WIND_SPEED, MIN_WIND_SPEED } from "./constants";

export type WindDirection = "left" | "right";

export interface WindOn {
  enabled: true;
  direction: WindDirection;
  speed: number; // cm/s, non-negative
  airDensity: number; // g/cm³
  dragCoefficient: number;
}

export interface WindOff {
  enabled: false;
}

/** A node's local wind configuration; disabled unless a PUT /wind is in effect. */
export type WindState = WindOn | WindOff;

export const NO_WIND: WindOff = { enabled: false };

export class WindError extends Error {}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Validates a PUT /wind body. Throws WindError for anything malformed or out of range. */
export function parseWindOnRequest(body: unknown): WindOn {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new WindError("Wind request must be a JSON object");
  }
  const { enabled, direction, speed, airDensity, dragCoefficient } = body as Record<string, unknown>;

  if (enabled !== true) {
    throw new WindError('"enabled" must be true');
  }
  if (direction !== "left" && direction !== "right") {
    throw new WindError('"direction" must be "left" or "right"');
  }
  if (!isFiniteNumber(speed) || speed < MIN_WIND_SPEED || speed > MAX_WIND_SPEED) {
    throw new WindError(`"speed" must be a number between ${MIN_WIND_SPEED} and ${MAX_WIND_SPEED}`);
  }
  if (!isFiniteNumber(airDensity) || airDensity <= 0) {
    throw new WindError('"airDensity" must be a positive number');
  }
  if (!isFiniteNumber(dragCoefficient) || dragCoefficient < 0) {
    throw new WindError('"dragCoefficient" must be a non-negative number');
  }

  return { enabled: true, direction, speed, airDensity, dragCoefficient };
}
