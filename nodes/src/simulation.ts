import type { CliOptions } from "./config";
import { PHYSICS_HZ } from "./constants";
import { type PendulumState, createPendulum, updatePendulum } from "./physics";

// `ready` is the configured-but-never-started state a node boots into.
export type Lifecycle = "ready" | "running" | "paused" | "stopped" | "restarting";

export type PendulumConfig = CliOptions;

/** One node's pendulum: its configuration, physics state and lifecycle. */
export class Simulation {
  private _config: PendulumConfig;
  private _state: PendulumState;
  private _lifecycle: Lifecycle = "ready";
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

  pause(): void {
    this._lifecycle = "paused";
  }

  stop(): void {
    this._lifecycle = "stopped";
  }

  /** Advances one fixed timestep, but only while running. */
  tick(): void {
    if (this._lifecycle !== "running") return;
    this._state = updatePendulum(this._state, this._config.length);
  }

  /** Starts the 60 Hz timer. Ticks are no-ops unless the lifecycle is running. */
  startLoop(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 1000 / PHYSICS_HZ);
  }

  stopLoop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
