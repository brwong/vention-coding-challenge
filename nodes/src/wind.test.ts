import { describe, expect, it } from "vitest";
import { DEFAULT_AIR_DENSITY, DEFAULT_SPHERE_DRAG_COEFFICIENT, MAX_WIND_SPEED } from "./constants";
import { WindError, parseWindOnRequest } from "./wind";

const VALID = {
  enabled: true,
  direction: "left",
  speed: 500,
  airDensity: DEFAULT_AIR_DENSITY,
  dragCoefficient: DEFAULT_SPHERE_DRAG_COEFFICIENT,
};

describe("parseWindOnRequest", () => {
  it("accepts a fully specified request", () => {
    expect(parseWindOnRequest(VALID)).toEqual(VALID);
  });

  it("accepts the right direction and the speed limits", () => {
    expect(parseWindOnRequest({ ...VALID, direction: "right" }).direction).toBe("right");
    expect(parseWindOnRequest({ ...VALID, speed: 0 }).speed).toBe(0);
    expect(parseWindOnRequest({ ...VALID, speed: MAX_WIND_SPEED }).speed).toBe(MAX_WIND_SPEED);
  });

  it.each([
    [null, /JSON object/],
    [[1, 2], /JSON object/],
    [{ ...VALID, enabled: false }, /"enabled" must be true/],
    [{ ...VALID, enabled: "true" }, /"enabled" must be true/],
    [{ ...VALID, direction: "up" }, /"direction"/],
    [{ ...VALID, direction: undefined }, /"direction"/],
    [{ ...VALID, speed: -1 }, /"speed"/],
    [{ ...VALID, speed: MAX_WIND_SPEED + 1 }, /"speed"/],
    [{ ...VALID, speed: Infinity }, /"speed"/],
    [{ ...VALID, speed: "500" }, /"speed"/],
    [{ ...VALID, airDensity: 0 }, /"airDensity"/],
    [{ ...VALID, airDensity: -1 }, /"airDensity"/],
    [{ ...VALID, dragCoefficient: -0.1 }, /"dragCoefficient"/],
  ])("rejects %j with a WindError", (body, message) => {
    expect(() => parseWindOnRequest(body)).toThrow(WindError);
    expect(() => parseWindOnRequest(body)).toThrow(message);
  });

  it("accepts a zero drag coefficient", () => {
    expect(parseWindOnRequest({ ...VALID, dragCoefficient: 0 }).dragCoefficient).toBe(0);
  });
});
