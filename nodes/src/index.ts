import { ConfigError, USAGE, loadConfig } from "./config";
import { HEARTBEAT_INTERVAL_MS } from "./constants";
import { createApp } from "./server";
import { MembershipService } from "./services/membershipService";
import { Simulation } from "./simulation";
import { logStartup, startStatusLogger } from "./terminal";

async function main(): Promise<void> {
  const loaded = await loadConfig();
  if (loaded === null) {
    console.log(USAGE);
    return;
  }

  const { config, server } = loaded;
  const { nodeId, port, joinOrder, ...pendulumConfig } = config;

  const simulation = new Simulation(pendulumConfig);
  const membership = new MembershipService({ nodeId, port }, () => {
    const { x, length, mass } = simulation.config;
    return { x, length, mass };
  });
  server.on("request", createApp({ nodeId, port }, simulation, { membership }));
  simulation.startLoop();

  logStartup(config);
  await membership.probeLowerPorts();
  const stopHeartbeat = membership.startHeartbeat(
    () => ({ type: "HEARTBEAT", nodeId, term: 0, isLeader: false }),
    HEARTBEAT_INTERVAL_MS,
  );
  const stopStatusLogger = startStatusLogger(nodeId, simulation);

  const shutdown = () => {
    stopHeartbeat();
    stopStatusLogger();
    simulation.stopLoop();
    server.close();
    // Polling clients hold keep-alive connections that would delay close().
    server.closeAllConnections();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((err: unknown) => {
  if (err instanceof ConfigError) {
    console.error(`Error: ${err.message}\n\n${USAGE}`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
