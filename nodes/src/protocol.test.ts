import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PEER_SUSPECT_MS, RESTART_BARRIER_TIMEOUT_MS, RESTART_DELAY_MS } from "./constants";
import { createPendulum } from "./physics";
import { CollisionService } from "./services/collisionService";
import { ElectionService } from "./services/electionService";
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
  const election = new ElectionService(SELF, membership);
  const protocol = new ProtocolService(SELF, simulation, membership, election);
  const position = new PositionService(SELF, membership);
  const collision = new CollisionService(SELF, simulation, membership, position, election);
  return { simulation, membership, election, protocol, position, collision, peerIds, broadcasts };
}

type Node = ReturnType<typeof createNode>;

const stop = (term: number, from = "node-7704") => ({ type: "STOP" as const, term, from });
const restart = (term: number, from: string) => ({ type: "RESTART" as const, term, from });

/** A running node at `term` that has just obeyed STOP for `term + 1`. */
function stoppedNode(term = 5): Node {
  const node = createNode();
  node.election.currentTerm = term;
  node.simulation.start();
  node.protocol.handleStop(stop(term + 1));
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

describe("term filtering", () => {
  it("ignores STOP from an older term", () => {
    const node = createNode();
    node.election.currentTerm = 5;
    node.simulation.start();
    node.protocol.handleStop(stop(3));
    expect(node.simulation.lifecycle).toBe("running");
    expect(node.election.currentTerm).toBe(5);
  });

  it("obeys STOP from a newer term and adopts the term and its leader", () => {
    const node = createNode();
    node.election.currentTerm = 5;
    node.simulation.start();
    node.protocol.handleStop(stop(6, "node-7704"));
    expect(node.simulation.lifecycle).toBe("stopped");
    expect(node.election.currentTerm).toBe(6);
    expect(node.election.leaderId).toBe("node-7704");
    expect(node.protocol.state.awaitingRestart).toBe(true);
  });

  it("ignores a repeated STOP for the same term", () => {
    const node = stoppedNode(5);
    node.protocol.handleRestart(restart(6, "node-7704"));
    const barrier = node.protocol.state.restartBarrier;
    node.protocol.handleStop(stop(6));
    expect(node.protocol.state.restartBarrier).toEqual(barrier);
  });

  it("adds a RESTART for the current term to the barrier and echoes it once", () => {
    const node = stoppedNode(5);
    node.protocol.handleRestart(restart(6, "node-7704"));
    node.protocol.handleRestart(restart(6, "node-7703"));
    node.protocol.handleRestart(restart(6, "node-7703"));
    expect(node.protocol.state.restartBarrier).toEqual(new Set([SELF, "node-7704", "node-7703"]));
    const echoes = node.broadcasts.filter((m) => m.type === "RESTART");
    expect(echoes).toEqual([{ type: "RESTART", term: 6, from: SELF }]);
  });

  it("ignores RESTART from an older term", () => {
    const node = stoppedNode(5);
    node.protocol.handleRestart(restart(5, "node-7704"));
    expect(node.protocol.state.restartBarrier.size).toBe(0);
    expect(node.broadcasts).toEqual([]);
  });

  it("stops when a RESTART arrives before its STOP", () => {
    const node = createNode();
    node.election.currentTerm = 5;
    node.simulation.start();
    node.protocol.handleRestart(restart(6, "node-7704"));
    expect(node.simulation.lifecycle).toBe("stopped");
    expect(node.election.currentTerm).toBe(6);
    expect(node.protocol.state.restartBarrier.has("node-7704")).toBe(true);

    // The late STOP changes nothing.
    node.protocol.handleStop(stop(6));
    expect(node.protocol.state.restartBarrier.has("node-7704")).toBe(true);
  });
});

describe("lifecycle state machine", () => {
  function completeBarrier(node: Node, term: number) {
    for (const peer of node.peerIds) node.protocol.handleRestart(restart(term, peer));
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
    // This node's own echo plus 3 peers.
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
});

describe("leader handling of collision reports", () => {
  function leaderNode(): Node {
    const node = createNode();
    node.election.currentTerm = 5;
    node.election.leaderId = SELF;
    node.simulation.start();
    return node;
  }

  it("starts a new term, stops and broadcasts STOP, then RESTART", async () => {
    // The pause between STOP and RESTART uses timers/promises, which fake timers do not cover.
    vi.useRealTimers();
    const node = leaderNode();
    const reply = node.protocol.handleCollisionDetected({
      type: "COLLISION_DETECTED",
      nodeId: "node-7702",
      term: 5,
    });
    expect(reply).toEqual({ accepted: true });
    expect(node.election.currentTerm).toBe(6);
    expect(node.simulation.lifecycle).toBe("stopped");
    expect(node.broadcasts).toContainEqual({ type: "STOP", term: 6, from: SELF });

    await vi.waitFor(() => {
      expect(node.broadcasts).toContainEqual({ type: "RESTART", term: 6, from: SELF });
    });
    expect(node.protocol.state.restartBarrier.has(SELF)).toBe(true);
    node.protocol.dispose();
  });

  it("rejects reports from an old term, so one collision causes one STOP", () => {
    const node = leaderNode();
    const report = { type: "COLLISION_DETECTED" as const, nodeId: "node-7702", term: 5 };
    expect(node.protocol.handleCollisionDetected(report)).toEqual({ accepted: true });
    expect(node.protocol.handleCollisionDetected(report)).toEqual({ accepted: false });
    expect(node.election.currentTerm).toBe(6);
  });

  it("rejects reports when this node is not the leader", () => {
    const node = createNode();
    node.election.leaderId = "node-7704";
    node.simulation.start();
    const reply = node.protocol.handleCollisionDetected({
      type: "COLLISION_DETECTED",
      nodeId: "node-7702",
      term: 0,
    });
    expect(reply).toEqual({ accepted: false });
    expect(node.simulation.lifecycle).toBe("running");
  });

  it("rejects reports when the leader cannot hear from a majority", () => {
    const node = leaderNode();
    for (const peer of node.peerIds.slice(1)) {
      node.membership.peers.get(peer)!.lastHeartbeat = Date.now() - PEER_SUSPECT_MS - 1;
    }
    const reply = node.protocol.handleCollisionDetected({
      type: "COLLISION_DETECTED",
      nodeId: "node-7702",
      term: 5,
    });
    expect(reply).toEqual({ accepted: false });
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

  it("uses the newest position by seq, even if messages arrive out of order", () => {
    const node = nodeWithPeer(0, -20);
    node.position.handlePosition({ type: "POSITION", pendulumId: "node-7701", angle: 0.35, seq: 5 });
    node.position.handlePosition({ type: "POSITION", pendulumId: "node-7701", angle: -1, seq: 4 });
    expect(node.position.positionCache.get("node-7701")?.angle).toBe(0.35);
    expect(node.collision.findCollision()).not.toBeNull();
  });

  it("reports a collision to the leader once per term, and only while running", () => {
    const node = nodeWithPeer(0, 20);
    const send = vi.spyOn(node.collision, "sendCollisionDetected").mockResolvedValue();
    node.election.leaderId = "node-7701";
    node.election.currentTerm = 3;

    node.collision.checkCollisions();
    expect(send).not.toHaveBeenCalled(); // still "ready"

    node.simulation.start();
    node.collision.checkCollisions();
    node.collision.checkCollisions();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(7701, 3);

    node.election.currentTerm = 4;
    node.collision.checkCollisions();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("waits for a leader before reporting", () => {
    const node = nodeWithPeer(0, 20);
    const send = vi.spyOn(node.collision, "sendCollisionDetected").mockResolvedValue();
    node.simulation.start();
    node.collision.checkCollisions();
    expect(send).not.toHaveBeenCalled();
  });
});
