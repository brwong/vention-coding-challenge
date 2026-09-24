import type { Config } from "./config";
import { HINGE_Y, STATUS_LOG_INTERVAL_MS } from "./constants";
import { calculateBobRadius, getPosition } from "./physics";
import type { Simulation } from "./simulation";

export function logStartup(config: Config): void {
  const radius = calculateBobRadius(config.mass).toFixed(1);
  console.log(`Pendulum Node ${config.nodeId} started on port ${config.port}`);
  console.log(
    `Config: x=${config.x}, length=${config.length}, mass=${config.mass} (radius=${radius}), angle=${config.angle}°`,
  );
}

export function formatStatus(nodeId: string, simulation: Simulation): string {
  const { state, config, lifecycle } = simulation;
  const angleDeg = (state.angle * 180) / Math.PI;
  const bob = getPosition(state, config.x, HINGE_Y, config.length);
  const position = `(${bob.x.toFixed(1)}, ${bob.y.toFixed(1)})`;
  return `[${nodeId}] angle: ${angleDeg.toFixed(1)}°, bob: ${position}, running: ${lifecycle === "running"}, lifecycle: ${lifecycle}`;
}

let statusLine: string | null = null;

/**
 * Prints a protocol event on its own line, above the status line that
 * startStatusLogger keeps redrawing.
 */
export function logEvent(message: string): void {
  const time = new Date().toLocaleTimeString([], { hour12: false });
  const line = `${time} ${message}`;
  if (process.stdout.isTTY && statusLine !== null) {
    process.stdout.write(`\r\x1b[2K${line}\n${statusLine}`);
  } else {
    console.log(line);
  }
}

/**
 * Prints a status summary periodically. On a terminal it redraws one line in
 * place; when output is piped, it appends a line each time instead.
 * Returns a function that stops the logger.
 */
export function startStatusLogger(nodeId: string, simulation: Simulation): () => void {
  const out = process.stdout;
  const print = () => {
    const line = formatStatus(nodeId, simulation);
    if (out.isTTY) {
      statusLine = line;
      out.write(`\r\x1b[2K${line}`);
    } else {
      out.write(`${line}\n`);
    }
  };

  print();
  const timer = setInterval(print, STATUS_LOG_INTERVAL_MS);
  return () => {
    clearInterval(timer);
    statusLine = null;
    // Leave the cursor on a fresh line for whatever prints next.
    if (out.isTTY) out.write("\n");
  };
}
