import { ConfigError, USAGE, loadConfig } from "./config";
import { createApp } from "./server";
import { Simulation } from "./simulation";
import { logStartup, startStatusLogger } from "./terminal";

async function main(): Promise<void> {
  const loaded = await loadConfig();
  if (loaded === null) {
    console.log(USAGE);
    return;
  }

  const { config, server } = loaded;
  const { nodeId, port, ...pendulumConfig } = config;

  const simulation = new Simulation(pendulumConfig);
  server.on("request", createApp({ nodeId, port }, simulation));
  simulation.startLoop();

  logStartup(config);
  const stopStatusLogger = startStatusLogger(nodeId, simulation);

  const shutdown = () => {
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
