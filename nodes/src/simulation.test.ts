import { describe, expect, it } from "vitest";
import type { WindOn } from "./wind";
import { Simulation } from "./simulation";

const CONFIG = { x: 0, length: 100, mass: 4200, angle: 20 };

const WIND: WindOn = {
  enabled: true,
  direction: "right",
  speed: 5000,
  airDensity: 0.001225,
  dragCoefficient: 0.47,
};

describe("Simulation wind", () => {
  it("starts with wind disabled", () => {
    const simulation = new Simulation(CONFIG);
    expect(simulation.wind).toEqual({ enabled: false });
  });

  it("setWind enables and replaces the local wind configuration", () => {
    const simulation = new Simulation(CONFIG);
    simulation.setWind(WIND);
    expect(simulation.wind).toEqual(WIND);
    simulation.setWind({ ...WIND, direction: "left", speed: 1000 });
    expect(simulation.wind).toEqual({ ...WIND, direction: "left", speed: 1000 });
  });

  it("clearWind disables it", () => {
    const simulation = new Simulation(CONFIG);
    simulation.setWind(WIND);
    simulation.clearWind();
    expect(simulation.wind).toEqual({ enabled: false });
  });

  it("ticks use gravity only while wind is disabled", () => {
    const withoutWind = new Simulation(CONFIG);
    const withWindThenCleared = new Simulation(CONFIG);
    withWindThenCleared.setWind(WIND);
    withWindThenCleared.clearWind();

    withoutWind.start();
    withWindThenCleared.start();
    for (let i = 0; i < 30; i++) {
      withoutWind.tick();
      withWindThenCleared.tick();
    }
    expect(withWindThenCleared.state).toEqual(withoutWind.state);
  });

  it("ticks are affected by wind once enabled", () => {
    const withWind = new Simulation(CONFIG);
    const withoutWind = new Simulation(CONFIG);
    withWind.setWind(WIND);
    withWind.start();
    withoutWind.start();
    for (let i = 0; i < 30; i++) {
      withWind.tick();
      withoutWind.tick();
    }
    expect(withWind.state.angle).not.toBeCloseTo(withoutWind.state.angle, 6);
  });

  it("beginRestart (the existing reset operation) disables wind", () => {
    const simulation = new Simulation(CONFIG);
    simulation.setWind(WIND);
    simulation.beginRestart();
    expect(simulation.wind).toEqual({ enabled: false });
    expect(simulation.lifecycle).toBe("restarting");
  });
});
