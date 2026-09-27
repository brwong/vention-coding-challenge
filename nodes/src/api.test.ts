import type { Express } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPendulum } from "./physics";
import { createApp } from "./server";
import { MembershipService } from "./services/membershipService";
import type { PeerConfig } from "./services/messages";
import { PositionService } from "./services/positionService";
import { ProtocolService } from "./services/protocolService";
import { Simulation } from "./simulation";

const NODE_ID = "node-7700";
const PORT = 7700;
const INITIAL = { x: 0, length: 100, mass: 4200, angle: 20 };
const PEER_CONFIG: PeerConfig = { x: 100, length: 100, mass: 4200 };

let app: Express;
let simulation: Simulation;
let membership: MembershipService;
let position: PositionService;
let protocol: ProtocolService;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  simulation = new Simulation(INITIAL);
  membership = new MembershipService({ nodeId: NODE_ID, port: PORT }, () => {
    const { x, length, mass } = simulation.config;
    return { x, length, mass };
  });
  // Keep the node off the network: peers here exist only in the peer list.
  vi.spyOn(membership, "broadcast").mockResolvedValue([]);
  vi.spyOn(membership, "sendJoin").mockResolvedValue([]);
  position = new PositionService(NODE_ID, membership);
  protocol = new ProtocolService(NODE_ID, simulation, membership);
  app = createApp({ nodeId: NODE_ID, port: PORT }, simulation, {
    membership,
    position,
    protocol,
  });
});

afterEach(() => {
  simulation.stopLoop();
  protocol.dispose();
  vi.restoreAllMocks();
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function addPeer(nodeId: string, port: number) {
  membership.peers.set(nodeId, { nodeId, port, config: PEER_CONFIG, lastHeartbeat: 0 });
}

describe("GET /status", () => {
  it("returns the node's identity, state, config and lifecycle", async () => {
    const res = await request(app).get("/status").expect(200);
    expect(res.body).toEqual({
      nodeId: NODE_ID,
      port: PORT,
      state: {
        angle: createPendulum(20).angle,
        angularVelocity: 0,
        running: false,
        stopped: false,
        restarting: false,
      },
      config: INITIAL,
      lifecycle: "ready",
    });
  });

  it("returns numbers for the angle and velocity once swinging", async () => {
    simulation.start();
    simulation.tick();
    const { body } = await request(app).get("/status").expect(200);
    expect(typeof body.state.angle).toBe("number");
    expect(typeof body.state.angularVelocity).toBe("number");
    expect(body.state.angularVelocity).not.toBe(0);
    expect(body.state.running).toBe(true);
  });

  it("allows the web UI on another local port to read it", async () => {
    const res = await request(app).get("/status").set("Origin", "http://localhost:5173");
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    const other = await request(app).get("/status").set("Origin", "http://example.com");
    expect(other.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("GET /config", () => {
  it("returns the startup configuration", async () => {
    const res = await request(app).get("/config").expect(200);
    expect(res.body).toEqual(INITIAL);
  });

  it("returns the latest values after a PUT", async () => {
    await request(app).put("/config").send({ x: 250 }).expect(200);
    const res = await request(app).get("/config").expect(200);
    expect(res.body).toEqual({ ...INITIAL, x: 250 });
  });
});

describe("PUT /config", () => {
  it("updates one field and leaves the rest", async () => {
    const res = await request(app).put("/config").send({ length: 200 }).expect(200);
    expect(res.body).toEqual({ ...INITIAL, length: 200 });
    expect(simulation.config.length).toBe(200);
  });

  it("updates several fields in one request", async () => {
    const res = await request(app).put("/config").send({ mass: 2000, angle: 30 }).expect(200);
    expect(res.body).toEqual({ ...INITIAL, mass: 2000, angle: 30 });
  });

  it("tells peers about the new configuration", async () => {
    await request(app).put("/config").send({ x: 50 }).expect(200);
    expect(membership.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "JOIN", config: { x: 50, length: 100, mass: 4200 } }),
    );
  });

  it.each([
    [{ length: -10 }, /length must be between/],
    [{ mass: 0 }, /mass must be between/],
    [{ angle: 200 }, /angle must be between/],
    [{ angle: "abc" }, /angle must be a finite number/],
    [{ length: 150, mass: -1 }, /mass must be between/],
    [{ color: "red" }, /Unknown field/],
  ])("rejects %j with 400 and leaves the config unchanged", async (body, message) => {
    const res = await request(app).put("/config").send(body).expect(400);
    expect(res.body.error).toMatch(message);
    expect(simulation.config).toEqual(INITIAL);
  });

  it("rejects malformed JSON with 400", async () => {
    const res = await request(app)
      .put("/config")
      .set("Content-Type", "application/json")
      .send("{ length: ")
      .expect(400);
    expect(res.body).toEqual({ error: "Request body is not valid JSON" });
  });
});

describe("lifecycle commands", () => {
  it("POST /start makes the node run", async () => {
    const res = await request(app).post("/start").expect(200);
    expect(res.body).toEqual({ lifecycle: "running" });
    const status = await request(app).get("/status");
    expect(status.body.state.running).toBe(true);
  });

  it("POST /pause holds the pendulum where it is", async () => {
    simulation.start();
    for (let i = 0; i < 10; i++) simulation.tick();
    const angle = simulation.state.angle;

    const res = await request(app).post("/pause").expect(200);
    expect(res.body).toEqual({ lifecycle: "paused" });
    simulation.tick();
    const status = await request(app).get("/status");
    expect(status.body.state.running).toBe(false);
    expect(status.body.state.angle).toBe(angle);
  });

  it("POST /stop stops the node, and a later start swings from the initial angle", async () => {
    simulation.start();
    for (let i = 0; i < 10; i++) simulation.tick();

    const res = await request(app).post("/stop").expect(200);
    expect(res.body).toEqual({ lifecycle: "stopped" });
    expect((await request(app).get("/status")).body.state.stopped).toBe(true);

    await request(app).post("/start").expect(200);
    expect(simulation.state.angle).toBe(createPendulum(20).angle);
  });

  it("POST /reset swings back to the initial angle and stays ready", async () => {
    simulation.start();
    for (let i = 0; i < 10; i++) simulation.tick();

    const res = await request(app).post("/reset").expect(200);
    expect(res.body).toEqual({ lifecycle: "ready" });
    const status = await request(app).get("/status");
    expect(status.body.lifecycle).toBe("ready");
    expect(status.body.state.angle).toBe(createPendulum(20).angle);
    expect(status.body.state.running).toBe(false);
  });

  it("returns 404 for unknown endpoints", async () => {
    const res = await request(app).post("/explode").expect(404);
    expect(res.body).toEqual({ error: "Not found" });
  });
});

describe("PUT /wind", () => {
  const VALID_WIND = {
    enabled: true,
    direction: "left",
    speed: 500,
    airDensity: 0.001225,
    dragCoefficient: 0.47,
  };

  it("enables local wind state", async () => {
    const res = await request(app).put("/wind").send(VALID_WIND).expect(200);
    expect(res.body).toEqual(VALID_WIND);
    expect(simulation.wind).toEqual(VALID_WIND);
  });

  it("replaces the previous wind configuration", async () => {
    await request(app).put("/wind").send(VALID_WIND).expect(200);
    const replacement = { ...VALID_WIND, direction: "right", speed: 2000 };
    await request(app).put("/wind").send(replacement).expect(200);
    expect(simulation.wind).toEqual(replacement);
  });

  it.each([
    [{ ...VALID_WIND, enabled: false }, /"enabled"/],
    [{ ...VALID_WIND, direction: "up" }, /"direction"/],
    [{ ...VALID_WIND, speed: -1 }, /"speed"/],
    [{ ...VALID_WIND, speed: 10001 }, /"speed"/],
    [{ ...VALID_WIND, airDensity: 0 }, /"airDensity"/],
    [{ ...VALID_WIND, dragCoefficient: -1 }, /"dragCoefficient"/],
  ])("rejects %j with 400 and leaves wind unchanged", async (body, message) => {
    const res = await request(app).put("/wind").send(body).expect(400);
    expect(res.body.error).toMatch(message);
    expect(simulation.wind).toEqual({ enabled: false });
  });
});

describe("DELETE /wind", () => {
  it("disables local wind state", async () => {
    await request(app)
      .put("/wind")
      .send({ enabled: true, direction: "left", speed: 500, airDensity: 0.001225, dragCoefficient: 0.47 })
      .expect(200);
    const res = await request(app).delete("/wind").expect(200);
    expect(res.body).toEqual({ enabled: false });
    expect(simulation.wind).toEqual({ enabled: false });
  });

  it("is a no-op when wind is already disabled", async () => {
    const res = await request(app).delete("/wind").expect(200);
    expect(res.body).toEqual({ enabled: false });
  });
});

describe("POST /message", () => {
  it("answers JOIN with this node and the peers it knows", async () => {
    addPeer("node-7701", 7701);
    const res = await request(app)
      .post("/message")
      .send({ type: "JOIN", nodeId: "node-7702", port: 7702, config: PEER_CONFIG })
      .expect(200);
    expect(res.body).toEqual({
      type: "JOIN_RESPONSE",
      nodeId: NODE_ID,
      port: PORT,
      config: { x: 0, length: 100, mass: 4200 },
      peers: [
        { nodeId: NODE_ID, port: PORT },
        { nodeId: "node-7701", port: 7701 },
      ],
    });
    expect(membership.peers.get("node-7702")?.config).toEqual(PEER_CONFIG);
  });

  it("refreshes a peer's last heartbeat and adopts its epoch on HEARTBEAT", async () => {
    addPeer("node-7701", 7701);
    await request(app)
      .post("/message")
      .send({ type: "HEARTBEAT", nodeId: "node-7701", epoch: 2 })
      .expect(200, { accepted: true });
    expect(membership.peers.get("node-7701")!.lastHeartbeat).toBeGreaterThan(Date.now() - 1000);
    const res = await request(app).get("/protocol-status").expect(200);
    expect(res.body.epoch).toBe(2);
  });

  it("joins an unknown sender instead of ignoring it", async () => {
    await request(app)
      .post("/message")
      .send({ type: "HEARTBEAT", nodeId: "node-7705", epoch: 0 })
      .expect(200);
    expect(membership.sendJoin).toHaveBeenCalledWith(7705);
  });

  it("stops the node on STOP from a newer epoch", async () => {
    addPeer("node-7701", 7701);
    simulation.start();
    await request(app)
      .post("/message")
      .send({ type: "STOP", epoch: 1, from: "node-7701", reporter: "node-7701" })
      .expect(200, { accepted: true });
    expect(simulation.lifecycle).toBe("stopped");
    expect(protocol.state.stoppedBy).toBe("node-7701");
  });

  it("adds RESTART to the barrier", async () => {
    addPeer("node-7701", 7701);
    await request(app)
      .post("/message")
      .send({ type: "STOP", epoch: 1, from: "node-7701", reporter: "node-7701" });
    await request(app)
      .post("/message")
      .send({ type: "RESTART", epoch: 1, from: "node-7701" })
      .expect(200);
    // This node adds its own RESTART after a short pause.
    expect(protocol.state.restartBarrier).toEqual(new Set(["node-7701"]));
  });

  it("caches the latest POSITION", async () => {
    addPeer("node-7701", 7701);
    await request(app)
      .post("/message")
      .send({ type: "POSITION", pendulumId: "node-7701", angle: 0.25, seq: 7 })
      .expect(200);
    expect(position.positionCache.get("node-7701")).toMatchObject({ angle: 0.25, seq: 7 });
  });

  it.each([
    [{ type: "HELLO" }, /Unknown message type/],
    [{}, /Unknown message type/],
    [{ type: "STOP", epoch: "1", from: "node-7701" }, /needs a valid "epoch"/],
    [{ type: "POSITION", pendulumId: "node-7701", angle: null, seq: 1 }, /needs a valid "angle"/],
    [{ type: "JOIN", nodeId: "node-7701", port: 7701, config: { x: 0 } }, /needs a valid "config"/],
  ])("rejects %j with 400", async (body, message) => {
    const res = await request(app).post("/message").send(body).expect(400);
    expect(res.body.error).toMatch(message);
  });
});

describe("simulation over HTTP", () => {
  beforeEach(() => {
    simulation.startLoop();
  });

  it("swings once started", async () => {
    await request(app).post("/start").expect(200);
    await wait(200);
    const { body } = await request(app).get("/status");
    expect(body.state.angle).not.toBe(createPendulum(20).angle);
  });

  it("holds still once paused", async () => {
    await request(app).post("/start").expect(200);
    await wait(100);
    await request(app).post("/pause").expect(200);
    const paused = (await request(app).get("/status")).body.state.angle;
    await wait(200);
    expect((await request(app).get("/status")).body.state.angle).toBe(paused);
  });

  it("resets to the new initial angle when the config changes", async () => {
    await request(app).post("/start").expect(200);
    await wait(100);
    await request(app).put("/config").send({ angle: -45 }).expect(200);
    await request(app).post("/pause");
    const { body } = await request(app).get("/status");
    expect(body.state.angle).toBeCloseTo(createPendulum(-45).angle, 1);
  });
});
