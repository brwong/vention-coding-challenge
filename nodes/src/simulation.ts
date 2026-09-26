import type { Config } from "./config";
import { PHYSICS_HZ } from "./constants";
import { type PendulumState, createPendulum, updatePendulum } from "./physics";
import { NO_WIND, type WindOn, type WindState } from "./wind";

// `ready` is the configured-but-never-started state a node boots into.
export type Lifecycle = "ready" | "running" | "paused" | "stopped" | "restarting";

export type PendulumConfig = Omit<Config, "port" | "nodeId" | "joinOrder">;

/** One node's pendulum: its configuration, physics state and lifecycle. */
export class Simulation {
  private _config: PendulumConfig;
  private _state: PendulumState;
  private _lifecycle: Lifecycle = "ready";
  private _wind: WindState = NO_WIND;
  private timer: NodeJS.Timeout | undefined;

  constructor(config: PendulumConfig) {
    this._config = { ...config };
    this._state = createPendulum(config.angle);
  }

  get config(): PendulumConfig {
    return { ...this._config };
  }

  get state(): PendulumState {
    return { ...this._state };
  }

  get lifecycle(): Lifecycle {
    return this._lifecycle;
  }

  get wind(): WindState {
    return this._wind;
  }

  /** Replaces the local wind configuration and enables it. */
  setWind(wind: WindOn): void {
    this._wind = wind;
  }

  /** Disables wind locally; subsequent ticks use gravity only. */
  clearWind(): void {
    this._wind = NO_WIND;
  }

  /** Merges in new values and resets the pendulum to the (new) initial angle. */
  applyConfig(update: Partial<PendulumConfig>): PendulumConfig {
    this._config = { ...this._config, ...update };
    this._state = createPendulum(this._config.angle);
    return this.config;
  }

  /** Resumes from pause, or swings again from the initial angle after a stop. */
  start(): void {
    if (this._lifecycle === "stopped") {
      this._state = createPendulum(this._config.angle);
    }
    this._lifecycle = "running";
  }

  /**
   * Moves the pendulum back to its initial angle and holds it there until
   * start(). This is the existing simulation reset operation, so it also
   * disables wind locally (see docs/bonus-wind.md).
   */
  beginRestart(): void {
    this._state = createPendulum(this._config.angle);
    this._wind = NO_WIND;
    this._lifecycle = "restarting";
  }

  pause(): void {
    this._lifecycle = "paused";
  }

  stop(): void {
    this._lifecycle = "stopped";
  }

  /** Advances one fixed timestep, but only while running. */
  tick(): void {
    if (this._lifecycle !== "running") return;
    this._state = updatePendulum(this._state, this._config.length, this._config.mass, this._wind);
  }

  /**
   * Starts the 60 Hz timer. Ticks are no-ops unless the lifecycle is running,
   * but `afterTick` runs on every one.
   */
  startLoop(afterTick: () => void = () => {}): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick();
      afterTick();
    }, 1000 / PHYSICS_HZ);
  }

  stopLoop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
