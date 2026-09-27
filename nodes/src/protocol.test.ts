import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PEER_SUSPECT_MS,
  RESTART_BARRIER_TIMEOUT_MS,
  RESTART_DELAY_MS,
  STOP_TO_RESTART_DELAY_MS,
} from "./constants";
import { createPendulum } from "./physics";
import { CollisionService } from "./services/collisionService";
import { MembershipService } from "./services/membershipService";
import type { Message, PeerConfig } from "./services/messages";
import { PositionService } from "./services/positionService";
import { ProtocolService } from "./services/protocolService";
import { Simulation } from "./simulation";

const SELF = "node-7700";
const CONFIG: PeerConfig = { x: 0, length: 100, mass: 4200 };

/**
 * One node's services wired together, with `peerCount` peers on ports above
 * it. Nothing goes over the network: broadcasts are recorded instead.
 */
function createNode(peerCount = 4) {
  const simulation = new Simulation({ ...CONFIG, angle: 20 });
  const membership = new MembershipService({ nodeId: SELF, port: 7700 }, () => CONFIG);
  const peerIds = Array.from({ length: peerCount }, (_, i) => `node-${7701 + i}`);
  for (const [i, nodeId] of peerIds.entries()) {
    membership.peers.set(nodeId, {
      nodeId,
      port: 7701 + i,
      config: { ...CONFIG, x: 100 * (i + 1) },
      lastHeartbeat: Date.now(),
    });
  }
  const broadcasts: Message[] = [];
  vi.spyOn(membership, "broadcast").mockImplementation(async (message) => {
    broadcasts.push(message);
    return [];
  });
  const protocol = new ProtocolService(SELF, simulation, membership);
  const position = new PositionService(SELF, membership);
  const collision = new CollisionService(simulation, membership, position, protocol);
  return { simulation, membership, protocol, position, collision, peerIds, broadcasts };
}

type Node = ReturnType<typeof createNode>;

const stop = (epoch: number, reporter = "node-7702") => ({
  type: "STOP" as const,
  epoch,
  from: reporter,
  reporter,
});
const restart = (epoch: number, from: string) => ({ type: "RESTART" as const, epoch, from });
const heartbeat = (epoch: number) => ({ type: "HEARTBEAT" as const, nodeId: "node-7704", epoch });
const sent = (node: Node, type: Message["type"]) => node.broadcasts.filter((m) => m.type === type);
/** Lets a stopped node send its RESTART. */
const pauseAfterStop = () => vi.advanceTimersByTime(STOP_TO_RESTART_DELAY_MS);

/**
 * A running node that knows of `epoch`, has obeyed STOP for `epoch + 1` and
 * has sent its own RESTART.
 */
function stoppedNode(epoch = 5): Node {
  const node = createNode();
  node.protocol.handleHeartbeat(heartbeat(epoch));
  node.simulation.start();
  node.protocol.handleStop(stop(epoch + 1));
  pauseAfterStop();
  return node;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("epoch filtering", () => {
  it("ignores STOP from an older epoch", () => {
    const node = createNode();
    node.protocol.handleHeartbeat(heartbeat(5));
    node.simulation.start();
    node.protocol.handleStop(stop(3));
    expect(node.simulation.lifecycle).toBe("running");
    expect(node.protocol.state.epoch).toBe(5);
    expect(node.broadcasts).toEqual([]);
  });

  it("obeys STOP from a newer epoch, adopts it and sends its own RESTART after a pause", () => {
    const node = createNode();
    node.protocol.handleHeartbeat(heartbeat(5));
    node.simulation.start();
    node.protocol.handleStop(stop(6));
    expect(node.simulation.lifecycle).toBe("stopped");
    vi.advanceTimersByTime(STOP_TO_RESTART_DELAY_MS - 1);
    expect(sent(node, "RESTART")).toEqual([]);
    vi.advanceTimersByTime(1);

    expect(node.protocol.state.epoch).toBe(6);
    expect(node.protocol.state.awaitingRestart).toBe(true);
    expect(node.protocol.state.stoppedBy).toBe("node-7702");
    expect(node.protocol.state.restartBarrier).toEqual(new Set([SELF]));
    expect(sent(node, "RESTART")).toEqual([{ type: "RESTART", epoch: 6, from: SELF }]);
  });

  it("obeys STOP for an epoch a heartbeat already carried", () => {
    const node = createNode();
    node.simulation.start();
    node.protocol.handleHeartbeat(heartbeat(6));
    node.protocol.handleStop(stop(6));
    expect(node.simulation.lifecycle).toBe("stopped");
  });

  it("ignores a repeated STOP for the same epoch", () => {
    const node = stoppedNode(5);
    node.protocol.handleRestart(restart(6, "node-7704"));
    const barrier = node.protocol.state.restartBarrier;
    node.protocol.handleStop(stop(6));
    expect(node.protocol.state.restartBarrier).toEqual(barrier);
    expect(sent(node, "RESTART")).toHaveLength(1);
  });

  it("adds each RESTART for the current epoch to the barrier once", () => {
    const node = stoppedNode(5);
    node.protocol.handleRestart(restart(6, "node-7704"));
    node.protocol.handleRestart(restart(6, "node-7703"));
    node.protocol.handleRestart(restart(6, "node-7703"));
    expect(node.protocol.state.restartBarrier).toEqual(new Set([SELF, "node-7704", "node-7703"]));
    expect(sent(node, "RESTART")).toHaveLength(1);
  });

  it("ignores RESTART from an older epoch", () => {
    const node = stoppedNode(5);
    node.protocol.handleRestart(restart(5, "node-7704"));
    expect(node.protocol.state.restartBarrier).toEqual(new Set([SELF]));
  });

  it("stops when a RESTART arrives before its STOP, and takes the reporter from the late STOP", () => {
    const node = createNode();
    node.protocol.handleHeartbeat(heartbeat(5));
    node.simulation.start();
    node.protocol.handleRestart(restart(6, "node-7704"));
    expect(node.simulation.lifecycle).toBe("stopped");
    expect(node.protocol.state.epoch).toBe(6);
    expect(node.protocol.state.stoppedBy).toBeNull();
    pauseAfterStop();
    expect(node.protocol.state.restartBarrier).toEqual(new Set([SELF, "node-7704"]));

    node.protocol.handleStop(stop(6, "node-7703"));
    expect(node.protocol.state.stoppedBy).toBe("node-7703");
    expect(node.protocol.state.restartBarrier).toEqual(new Set([SELF, "node-7704"]));
  });

  it("merges two reports of the same collision into one stop, blaming the lower ID", () => {
    const node = createNode();
    node.simulation.start();
    node.protocol.handleStop(stop(1, "node-7703"));
    node.protocol.handleStop(stop(1, "node-7702"));
    node.protocol.handleStop(stop(1, "node-7704"));
    pauseAfterStop();
    expect(node.protocol.state.stoppedBy).toBe("node-7702");
    expect(sent(node, "RESTART")).toHaveLength(1);
  });
});

describe("heartbeat epochs", () => {
  it("adopts a newer epoch without stopping", () => {
    const node = createNode();
    node.simulation.start();
    node.protocol.handleHeartbeat(heartbeat(7));
    expect(node.protocol.state.epoch).toBe(7);
    expect(node.simulation.lifecycle).toBe("running");
    node.protocol.handleHeartbeat(heartbeat(3));
    expect(node.protocol.state.epoch).toBe(7);
  });

  it("carries this node's epoch", () => {
    const node = stoppedNode(5);
    expect(node.protocol.heartbeat()).toEqual({ type: "HEARTBEAT", nodeId: SELF, epoch: 6 });
  });
});

describe("lifecycle state machine", () => {
  function completeBarrier(node: Node, epoch: number) {
    for (const peer of node.peerIds) node.protocol.handleRestart(restart(epoch, peer));
  }

  it("goes running → stopped → restarting → running", () => {
    const node = stoppedNode(5);
    expect(node.simulation.lifecycle).toBe("stopped");

    completeBarrier(node, 6);
    expect(node.simulation.lifecycle).toBe("restarting");
    expect(node.protocol.state.awaitingRestart).toBe(false);

    vi.advanceTimersByTime(RESTART_DELAY_MS - 1);
    expect(node.simulation.lifecycle).toBe("restarting");
    vi.advanceTimersByTime(1);
    expect(node.simulation.lifecycle).toBe("running");
  });

  it("resets the pendulum to its initial angle when the barrier completes", () => {
    const node = createNode();
    node.simulation.start();
    for (let i = 0; i < 30; i++) node.simulation.tick();
    node.protocol.handleStop(stop(1));
    const frozen = node.simulation.state.angle;
    expect(frozen).not.toBeCloseTo(createPendulum(20).angle, 3);
    pauseAfterStop();
    expect(node.simulation.state.angle).toBe(frozen);

    completeBarrier(node, 1);
    expect(node.simulation.state).toEqual(createPendulum(20));
    // The pendulum does not move during the countdown.
    node.simulation.tick();
    expect(node.simulation.state).toEqual(createPendulum(20));
  });

  it("ignores a late RESTART once the barrier has completed", () => {
    const node = stoppedNode(5);
    completeBarrier(node, 6);
    vi.advanceTimersByTime(RESTART_DELAY_MS);
    expect(node.simulation.lifecycle).toBe("running");

    node.protocol.handleRestart(restart(6, "node-7701"));
    expect(node.simulation.lifecycle).toBe("running");
  });

  it("cancels the countdown when a newer STOP arrives while restarting", () => {
    const node = stoppedNode(5);
    completeBarrier(node, 6);
    expect(node.simulation.lifecycle).toBe("restarting");

    node.protocol.handleStop(stop(7));
    expect(node.simulation.lifecycle).toBe("stopped");
    pauseAfterStop();
    vi.advanceTimersByTime(RESTART_DELAY_MS);
    expect(node.simulation.lifecycle).toBe("stopped");
  });

  it("stays paused if the UI pauses the node during the countdown", () => {
    const node = stoppedNode(5);
    completeBarrier(node, 6);
    node.simulation.pause();
    vi.advanceTimersByTime(RESTART_DELAY_MS);
    expect(node.simulation.lifecycle).toBe("paused");
  });

  it("restarts after the barrier timeout even if some RESTARTs never arrive", () => {
    const node = stoppedNode(5);
    node.protocol.handleRestart(restart(6, "node-7704"));
    vi.advanceTimersByTime(RESTART_BARRIER_TIMEOUT_MS);
    expect(node.simulation.lifecycle).toBe("restarting");
    vi.advanceTimersByTime(RESTART_DELAY_MS);
    expect(node.simulation.lifecycle).toBe("running");
  });
});

describe("restart quorum", () => {
  it("counts every live node, including this one", () => {
    expect(createNode(4).protocol.quorumSize).toBe(5);
    expect(createNode(0).protocol.quorumSize).toBe(1);
  });

  it("waits for all 5 live nodes: 4 RESTARTs are not enough", () => {
    const node = stoppedNode(5);
    // This node's own RESTART plus 3 peers.
    for (const peer of node.peerIds.slice(0, 3)) node.protocol.handleRestart(restart(6, peer));
    expect(node.protocol.state.restartBarrier.size).toBe(4);
    expect(node.simulation.lifecycle).toBe("stopped");

    node.protocol.handleRestart(restart(6, node.peerIds[3]));
    expect(node.simulation.lifecycle).toBe("restarting");
  });

  it("shrinks when peers are suspected dead", () => {
    const node = stoppedNode(5);
    for (const peer of node.peerIds.slice(2)) {
      node.membership.peers.get(peer)!.lastHeartbeat = Date.now() - PEER_SUSPECT_MS - 1;
    }
    expect(node.protocol.quorumSize).toBe(3);

    node.protocol.handleRestart(restart(6, node.peerIds[0]));
    expect(node.simulation.lifecycle).toBe("stopped");
    node.protocol.handleRestart(restart(6, node.peerIds[1]));
    expect(node.simulation.lifecycle).toBe("restarting");
  });

  it("completes on its own RESTART for a node with no peers", () => {
    const node = createNode(0);
    node.simulation.start();
    node.protocol.handleStop(stop(1));
    expect(node.simulation.lifecycle).toBe("stopped");
    pauseAfterStop();
    expect(node.simulation.lifecycle).toBe("restarting");
  });
});

describe("reporting a collision", () => {
  it("starts the next epoch, stops, and broadcasts STOP and its own RESTART", () => {
    const node = createNode();
    node.protocol.handleHeartbeat(heartbeat(5));
    node.simulation.start();
    node.protocol.reportCollision("node-7701");

    expect(node.simulation.lifecycle).toBe("stopped");
    expect(node.protocol.state.epoch).toBe(6);
    expect(node.protocol.state.stoppedBy).toBe(SELF);
    pauseAfterStop();
    expect(node.broadcasts).toEqual([
      { type: "STOP", epoch: 6, from: SELF, reporter: SELF },
      { type: "RESTART", epoch: 6, from: SELF },
    ]);
  });

  it("picks the same epoch as a peer reporting the same collision, so their stops merge", () => {
    const node = createNode();
    node.simulation.start();
    node.protocol.reportCollision("node-7701");
    node.protocol.handleStop(stop(1, "node-7701"));
    pauseAfterStop();
    expect(node.protocol.state.epoch).toBe(1);
    expect(sent(node, "STOP")).toHaveLength(1);
    expect(sent(node, "RESTART")).toHaveLength(1);
    expect(node.protocol.state.stoppedBy).toBe(SELF); // node-7700 outranks node-7701
  });
});

describe("collision detection", () => {
  /** Places one peer at `peerX` with its bob at `peerAngleDeg`; this node's bob is at 20°. */
  function nodeWithPeer(peerX: number, peerAngleDeg: number): Node {
    const node = createNode(1);
    node.membership.peers.get("node-7701")!.config.x = peerX;
    node.position.handlePosition({
      type: "POSITION",
      pendulumId: "node-7701",
      angle: (peerAngleDeg * Math.PI) / 180,
      seq: 0,
    });
    return node;
  }

  it("detects two pendulums with the same anchor, length and angle", () => {
    expect(nodeWithPeer(0, 20).collision.findCollision()?.nodeId).toBe("node-7701");
  });

  it("does not detect pendulums at clearly different angles", () => {
    expect(nodeWithPeer(0, -20).collision.findCollision()).toBeNull();
  });

  it("does not detect pendulums whose anchors are far apart, even at the same angle", () => {
    expect(nodeWithPeer(300, 20).collision.findCollision()).toBeNull();
  });

  it("ignores peers whose position is not known yet", () => {
    const node = createNode(1);
    node.membership.peers.get("node-7701")!.config.x = 0;
    expect(node.collision.findCollision()).toBeNull();
  });

  it("ignores a suspected peer's frozen position, so a dead node's ghost cannot cause a collision", () => {
    const node = nodeWithPeer(0, 20); // would otherwise collide
    node.membership.peers.get("node-7701")!.lastHeartbeat = Date.now() - PEER_SUSPECT_MS - 1;
    expect(node.collision.findCollision()).toBeNull();
  });

  it("still detects a collision with a peer that has recently sent a heartbeat", () => {
    const node = nodeWithPeer(0, 20);
    node.membership.peers.get("node-7701")!.lastHeartbeat = Date.now() - PEER_SUSPECT_MS + 500;
    expect(node.collision.findCollision()?.nodeId).toBe("node-7701");
  });

  it("uses the newest position by seq, even if messages arrive out of order", () => {
    const node = nodeWithPeer(0, -20);
    node.position.handlePosition({ type: "POSITION", pendulumId: "node-7701", angle: 0.35, seq: 5 });
    node.position.handlePosition({ type: "POSITION", pendulumId: "node-7701", angle: -1, seq: 4 });
    expect(node.position.positionCache.get("node-7701")?.angle).toBe(0.35);
    expect(node.collision.findCollision()).not.toBeNull();
  });

  it("reports a collision once, and only while running", () => {
    const node = nodeWithPeer(0, 20);
    const report = vi.spyOn(node.protocol, "reportCollision");

    node.collision.checkCollisions();
    expect(report).not.toHaveBeenCalled(); // still "ready"

    node.simulation.start();
    node.collision.checkCollisions();
    node.collision.checkCollisions(); // reporting stopped the node
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith("node-7701");
  });
});
