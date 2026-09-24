import cors from "cors";
import express, { type ErrorRequestHandler, type Express } from "express";
import { ConfigError, parseConfigUpdate } from "./config";
import type { PendulumConfig, Simulation } from "./simulation";

export interface NodeIdentity {
  nodeId: string;
  port: number;
}

// Section 4 fills these in; until then /message only checks the type.
export const MESSAGE_TYPES = [
  "JOIN",
  "HEARTBEAT",
  "STOP",
  "RESTART",
  "POSITION",
  "COLLISION_DETECTED",
  "ELECTION_REQUEST",
  "ELECTION_RESPONSE",
] as const;

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

export function createApp(identity: NodeIdentity, simulation: Simulation): Express {
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

  app.post("/message", (req, res) => {
    const type = req.body?.type;
    if (!MESSAGE_TYPES.includes(type)) {
      res.status(400).json({ error: `Unknown message type: ${String(type)}` });
      return;
    }
    res.status(202).json({ accepted: true, type });
  });

  app.get("/protocol-status", (_req, res) => {
    res.json({
      nodeId: identity.nodeId,
      term: 0,
      leader: null,
      peers: [],
    });
  });

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  const handleError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof ConfigError) {
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
