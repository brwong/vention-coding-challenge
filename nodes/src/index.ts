import { ConfigError, USAGE, loadConfig } from "./config";
import { HEARTBEAT_INTERVAL_MS } from "./constants";
import { createApp } from "./server";
import { CollisionService } from "./services/collisionService";
import { ElectionService } from "./services/electionService";
import { MembershipService } from "./services/membershipService";
import { PositionService } from "./services/positionService";
import { ProtocolService } from "./services/protocolService";
import { Simulation } from "./simulation";
import { logEvent, logStartup, startStatusLogger } from "./terminal";

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
  const election = new ElectionService(nodeId, membership);
  const position = new PositionService(nodeId, membership);
  const protocol = new ProtocolService(nodeId, simulation, membership, election);
  server.on(
    "request",
    createApp({ nodeId, port }, simulation, { membership, election, position, protocol }),
  );
  const collision = new CollisionService(nodeId, simulation, membership, position, election);
  simulation.startLoop(() => {
    position.broadcastPosition(simulation.state.angle);
    collision.checkCollisions();
  });

  logStartup(config);
  const peers = await membership.probeLowerPorts();
  logEvent(`Discovered peers: [${peers.map((peer) => peer.nodeId).join(", ")}]`);
  const stopHeartbeat = membership.startHeartbeat(
    () => election.heartbeat(),
    HEARTBEAT_INTERVAL_MS,
  );
  const stopElectionTimer = election.startElectionTimer();
  const stopStatusLogger = startStatusLogger(nodeId, simulation);

  const shutdown = () => {
    stopHeartbeat();
    stopElectionTimer();
    protocol.dispose();
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
