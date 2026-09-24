import cors from "cors";
import express, { type ErrorRequestHandler, type Express } from "express";
import { ConfigError, parseConfigUpdate } from "./config";
import type { MembershipService } from "./services/membershipService";
import { type Message, MessageError, parseMessage, senderOf } from "./services/messages";
import type { PendulumConfig, Simulation } from "./simulation";

export interface NodeIdentity {
  nodeId: string;
  port: number;
}

export interface Services {
  membership: MembershipService;
}

// Nodes only listen on loopback, so accept the web UI from any local port.
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function configBody(config: PendulumConfig) {
  return {
    x: config.x,
    length: config.length,
    mass: config.mass,
    angle: config.angle,
  };
}

/** Hands a peer message to the service responsible for its type. */
async function routeMessage(message: Message, services: Services): Promise<object> {
  switch (message.type) {
    case "JOIN":
      return services.membership.handleJoin(message);
    default:
      // HEARTBEAT only proves liveness, which /message records for every sender.
      return { accepted: true };
  }
}

export function createApp(
  identity: NodeIdentity,
  simulation: Simulation,
  services: Services,
): Express {
  const app = express();
  app.use(cors({ origin: LOCAL_ORIGIN }));
  app.use(express.json());

  app.get("/status", (_req, res) => {
    const { angle, angularVelocity } = simulation.state;
    const lifecycle = simulation.lifecycle;
    res.json({
      nodeId: identity.nodeId,
      port: identity.port,
      state: {
        angle,
        angularVelocity,
        running: lifecycle === "running",
        stopped: lifecycle === "stopped",
        restarting: lifecycle === "restarting",
      },
      config: configBody(simulation.config),
      lifecycle,
    });
  });

  app.get("/config", (_req, res) => {
    res.json(configBody(simulation.config));
  });

  app.put("/config", (req, res) => {
    const update = parseConfigUpdate(req.body);
    res.json(configBody(simulation.applyConfig(update)));
  });

  const lifecycleCommands = {
    start: () => simulation.start(),
    pause: () => simulation.pause(),
    stop: () => simulation.stop(),
  };
  for (const [name, command] of Object.entries(lifecycleCommands)) {
    app.post(`/${name}`, (_req, res) => {
      command();
      res.json({ lifecycle: simulation.lifecycle });
    });
  }

  app.post("/message", async (req, res) => {
    const message = parseMessage(req.body);
    // JOIN adds its sender itself; anything else counts as a sign of life.
    if (message.type !== "JOIN") services.membership.recordContact(senderOf(message));
    res.json(await routeMessage(message, services));
  });

  app.get("/protocol-status", (_req, res) => {
    const { membership } = services;
    const now = Date.now();
    res.json({
      nodeId: identity.nodeId,
      term: 0,
      leader: null,
      peers: [...membership.peers.values()].map((peer) => ({
        nodeId: peer.nodeId,
        port: peer.port,
        config: peer.config,
        msSinceHeartbeat: now - peer.lastHeartbeat,
        suspected: membership.isSuspected(peer, now),
      })),
    });
  });

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  const handleError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof ConfigError || err instanceof MessageError) {
      res.status(400).json({ error: err.message });
    } else if (err.type === "entity.parse.failed") {
      res.status(400).json({ error: "Request body is not valid JSON" });
    } else {
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    }
  };
  app.use(handleError);

  return app;
}
