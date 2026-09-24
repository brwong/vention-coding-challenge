import type { Config } from "./config";
import { STATUS_LOG_INTERVAL_MS } from "./constants";
import type { Simulation } from "./simulation";

export function logStartup(config: Config): void {
  const x = config.x ?? "auto";
  console.log(`Pendulum Node ${config.nodeId} started on port ${config.port}`);
  console.log(
    `Config: x=${x}, length=${config.length}, mass=${config.mass}, angle=${config.angle}°`,
  );
}

export function formatStatus(nodeId: string, simulation: Simulation): string {
  const angleDeg = (simulation.state.angle * 180) / Math.PI;
  const lifecycle = simulation.lifecycle;
  return `[${nodeId}] angle: ${angleDeg.toFixed(1)}°, running: ${lifecycle === "running"}, lifecycle: ${lifecycle}`;
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
      out.write(`\r\x1b[2K${line}`);
    } else {
      out.write(`${line}\n`);
    }
  };

  print();
  const timer = setInterval(print, STATUS_LOG_INTERVAL_MS);
  return () => {
    clearInterval(timer);
    // Leave the cursor on a fresh line for whatever prints next.
    if (out.isTTY) out.write("\n");
  };
}
