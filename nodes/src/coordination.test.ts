import { type ChildProcess, execSync, spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { BASE_PORT, HOST, PEER_TIMEOUT_MS } from "./constants";

// These tests start real node processes on the real ports, so they need
// BASE_PORT and up to be free, and take a few seconds each.

const NODES_DIR = path.resolve(__dirname, "..");
const PORTS_NEEDED = 6;

interface Node {
  port: number;
  nodeId: string;
  process: ChildProcess;
  output: string[];
}

interface ProtocolStatus {
  nodeId: string;
  epoch: number;
  lifecycle: string;
  stoppedBy: string | null;
  peers: { nodeId: string; suspected: boolean }[];
}

let nodes: Node[] = [];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, HOST, () => server.close(() => resolve(true)));
  });
}

/** Starts a node process and resolves once it reports the port it bound. */
function startNode(args: string[] = []): Promise<Node> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ["dist/index.js", ...args], { cwd: NODES_DIR });
    const output: string[] = [];
    let started = false;
    const timer = setTimeout(() => reject(new Error(`Node did not start:\n${output.join("")}`)), 5000);
    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");
    proc.stderr.on("data", (chunk: string) => output.push(chunk));
    proc.stdout.on("data", (chunk: string) => {
      output.push(chunk);
      const match = /Pendulum Node (node-\d+) started on port (\d+)/.exec(output.join(""));
      if (match && !started) {
        started = true;
        clearTimeout(timer);
        const node = { nodeId: match[1], port: Number(match[2]), process: proc, output };
        nodes.push(node);
        resolve(node);
      }
    });
    proc.once("exit", (code) => reject(new Error(`Node exited with ${code}:\n${output.join("")}`)));
  });
}

function killNode(node: Node, signal: NodeJS.Signals = "SIGKILL"): Promise<void> {
  nodes = nodes.filter((n) => n !== node);
  if (node.process.exitCode !== null || node.process.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    node.process.once("exit", () => resolve());
    node.process.kill(signal);
  });
}

async function get<T>(node: Node, route: string): Promise<T> {
  const response = await fetch(`http://${HOST}:${node.port}${route}`);
  return (await response.json()) as T;
}

async function post(node: Node, route: string, body?: object): Promise<void> {
  const response = await fetch(`http://${HOST}:${node.port}${route}`, {
    method: body ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body && JSON.stringify(body),
  });
  expect(response.ok).toBe(true);
}

const protocolStatus = (node: Node) => get<ProtocolStatus>(node, "/protocol-status");
const lifecycle = async (node: Node) => (await protocolStatus(node)).lifecycle;
const peerIds = async (node: Node) => (await protocolStatus(node)).peers.map((p) => p.nodeId).sort();

/** Polls `check` until it stops throwing, or fails with its last error after `timeoutMs`. */
async function eventually<T>(check: () => Promise<T>, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await check();
    } catch (err) {
      if (Date.now() > deadline) throw err;
      await sleep(100);
    }
  }
}

/** Waits until every node in `cluster` knows every other one. */
async function fullyConnected(cluster: Node[], timeoutMs = 3000): Promise<void> {
  await eventually(async () => {
    for (const node of cluster) expect(await peerIds(node)).toHaveLength(cluster.length - 1);
  }, timeoutMs);
}

type Lifecycles = Map<string, Map<string, number>>;

/**
 * Polls `cluster` until every node has stopped, restarted and is running
 * again (or `timeoutMs` passes), and returns when each node was first seen in
 * each lifecycle.
 */
async function watchStopAndRestart(cluster: Node[], timeoutMs: number): Promise<Lifecycles> {
  const seen: Lifecycles = new Map(cluster.map((n) => [n.nodeId, new Map()]));
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const statuses = await Promise.all(cluster.map(protocolStatus));
    statuses.forEach((status, i) => {
      const times = seen.get(cluster[i].nodeId)!;
      const state = status.lifecycle;
      if (!times.has(state) && (state !== "running" || times.has("restarting"))) {
        times.set(state, Date.now());
      }
    });
    if (cluster.every((node) => seen.get(node.nodeId)!.has("running"))) break;
    await sleep(25);
  }
  return seen;
}

/** Nodes set 60 apart swinging toward each other, which collide about 0.8 s after starting. */
const COLLIDING_PAIR = [
  ["--x", "0", "--angle", "-20"],
  ["--x", "60", "--angle", "20"],
];

async function startCluster(size: number): Promise<Node[]> {
  const cluster: Node[] = [];
  for (let i = 0; i < size; i++) cluster.push(await startNode());
  return cluster;
}

beforeAll(async () => {
  for (let port = BASE_PORT; port < BASE_PORT + PORTS_NEEDED; port++) {
    if (!(await isPortFree(port))) {
      throw new Error(`Port ${port} is in use; stop any running pendulum nodes before these tests`);
    }
  }
  execSync("npm run build", { cwd: NODES_DIR, stdio: "ignore" });
}, 60_000);

afterEach(async (context) => {
  if (context.task.result?.state === "fail") {
    for (const node of nodes) console.log(`--- ${node.nodeId} ---\n${node.output.join("")}`);
  }
  await Promise.all([...nodes].map((node) => killNode(node)));
});

describe("multi-node coordination", { timeout: 30_000 }, () => {
  it("discovers every peer, whatever order the nodes joined in", async () => {
    const [a, b, c] = await startCluster(3);
    expect([a.nodeId, b.nodeId, c.nodeId]).toEqual(["node-7700", "node-7701", "node-7702"]);

    // A learns about B and C from their JOINs; B learns about C the same way.
    await eventually(async () => {
      expect(await peerIds(a)).toEqual(["node-7701", "node-7702"]);
      expect(await peerIds(b)).toEqual(["node-7700", "node-7702"]);
      expect(await peerIds(c)).toEqual(["node-7700", "node-7701"]);
    }, 3000);

    const status = await get<{ config: { x: number } }>(c, "/status");
    expect(status.config.x).toBe(200); // spaced by join order
  });

  it("stops every node on a collision and restarts them together 5 seconds later", async () => {
    // A and B collide; C is far away but must stop and restart with them.
    const a = await startNode(COLLIDING_PAIR[0]);
    const b = await startNode(COLLIDING_PAIR[1]);
    const c = await startNode(["--x", "400"]);
    const cluster = [a, b, c];
    await fullyConnected(cluster);

    await Promise.all(cluster.map((node) => post(node, "/start")));
    const seen = await watchStopAndRestart(cluster, 12_000);
    const firstSeen = (node: Node, state: string) => seen.get(node.nodeId)!.get(state);

    const spread = (state: string) => {
      const times = cluster.map((node) => firstSeen(node, state));
      expect(times, `every node reached ${state}`).not.toContain(undefined);
      return Math.max(...(times as number[])) - Math.min(...(times as number[]));
    };
    expect(spread("stopped")).toBeLessThan(500);
    expect(spread("restarting")).toBeLessThan(500);
    expect(spread("running")).toBeLessThan(500);
    // About 5 seconds between the barrier completing and resuming.
    const countdown = firstSeen(a, "running")! - firstSeen(a, "restarting")!;
    expect(countdown).toBeGreaterThan(4500);
    expect(countdown).toBeLessThan(5500);

    // Both a and b may detect the collision, but their STOPs merge: every
    // node ends up in the same epoch and blames the same node, and never c,
    // which was not involved.
    const statuses = await Promise.all(cluster.map(protocolStatus));
    expect(new Set(statuses.map((status) => status.epoch))).toEqual(new Set([1]));
    const reporters = new Set(statuses.map((status) => status.stoppedBy));
    expect(reporters.size).toBe(1);
    expect([a.nodeId, b.nodeId]).toContain([...reporters][0]);
  });

  it("stops the cluster straight after a node dies, with nothing to wait for", async () => {
    // D has the highest ID, so under a leader it would have been the leader.
    const a = await startNode(COLLIDING_PAIR[0]);
    const b = await startNode(COLLIDING_PAIR[1]);
    const c = await startNode(["--x", "400"]);
    const d = await startNode(["--x", "600"]);
    await fullyConnected([a, b, c, d]);
    // Let the cluster settle, as a long-running one would have, before D dies.
    await sleep(3000);
    await killNode(d);

    // A and B collide about 0.8 s after starting, before D is even suspected
    // dead (2 s). That first collision must stop everyone; a later one, a
    // swing or two afterwards, would mean the first was missed.
    const cluster = [a, b, c];
    const started = Date.now();
    await Promise.all(cluster.map((node) => post(node, "/start")));
    const seen = await watchStopAndRestart(cluster, 20_000);
    for (const node of cluster) {
      const times = seen.get(node.nodeId)!;
      expect(times.get("stopped"), `${node.nodeId} stopped`).toBeDefined();
      expect(times.get("stopped")! - started, `${node.nodeId} stopped promptly`).toBeLessThan(1500);
      expect(times.get("running"), `${node.nodeId} running again`).toBeDefined();
    }
  });

  it("keeps running when a node dies, and takes it back when it restarts", async () => {
    const cluster = await startCluster(5);
    await fullyConnected(cluster);
    await Promise.all(cluster.map((node) => post(node, "/start")));

    const middle = cluster[2];
    expect(middle.nodeId).toBe("node-7702");
    await killNode(middle);
    const survivors = cluster.filter((node) => node !== middle);

    // Suspected within a couple of seconds, while everyone else keeps swinging.
    await eventually(async () => {
      for (const node of survivors) {
        const peer = (await protocolStatus(node)).peers.find((p) => p.nodeId === "node-7702");
        expect(peer?.suspected).toBe(true);
      }
    }, 4000);
    for (const node of survivors) expect(await lifecycle(node)).toBe("running");
    const before = await Promise.all(survivors.map((n) => get<{ state: { angle: number } }>(n, "/status")));
    await sleep(200);
    const after = await Promise.all(survivors.map((n) => get<{ state: { angle: number } }>(n, "/status")));
    after.forEach((status, i) => expect(status.state.angle).not.toBe(before[i].state.angle));

    // Dropped from the peer lists once the heartbeat timeout passes.
    await eventually(async () => {
      for (const node of survivors) expect(await peerIds(node)).not.toContain("node-7702");
    }, PEER_TIMEOUT_MS + 2000);

    // A new process takes the free port and rejoins.
    const replacement = await startNode();
    expect(replacement.nodeId).toBe("node-7702");
    await eventually(async () => {
      expect(await peerIds(replacement)).toHaveLength(4);
      for (const node of survivors) {
        const peer = (await protocolStatus(node)).peers.find((p) => p.nodeId === "node-7702");
        expect(peer?.suspected).toBe(false);
      }
    }, 3000);
    await post(replacement, "/start");
    expect(await lifecycle(replacement)).toBe("running");
  });
});
