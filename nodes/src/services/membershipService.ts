import { portFromNodeId } from "../config";
import { BASE_PORT, PEER_SUSPECT_MS, PEER_TIMEOUT_MS } from "../constants";
import {
  type HeartbeatMessage,
  type JoinMessage,
  type JoinResponse,
  type Message,
  type PeerAddress,
  type PeerConfig,
  sendMessage,
} from "./messages";

export interface Peer {
  nodeId: string;
  port: number;
  lastHeartbeat: number; // local timestamp of the last message received from this peer
  config: PeerConfig;
}

/**
 * Tracks the other nodes in the cluster. A node joins by sending JOIN to every
 * lower port that answers, then to any node those answers mention. Peers stay
 * listed while they keep sending messages and are dropped after a timeout.
 */
export class MembershipService {
  readonly peers = new Map<string, Peer>();
  private readonly joining = new Set<number>();

  constructor(
    private readonly self: PeerAddress,
    private readonly getConfig: () => PeerConfig,
  ) {}

  private joinMessage(): JoinMessage {
    return { type: "JOIN", ...this.self, config: this.getConfig() };
  }

  private addPeer(nodeId: string, port: number, config: PeerConfig): void {
    this.peers.set(nodeId, { nodeId, port, config, lastHeartbeat: Date.now() });
  }

  /**
   * Sends JOIN to one port. On a reply, records the responder as a peer and
   * returns the peers it knows about; returns [] if nothing answered.
   */
  async sendJoin(targetPort: number): Promise<PeerAddress[]> {
    if (this.joining.has(targetPort)) return [];
    this.joining.add(targetPort);
    try {
      const reply = await sendMessage<JoinResponse>(targetPort, this.joinMessage());
      if (reply?.type !== "JOIN_RESPONSE" || reply.port !== targetPort) return [];
      this.addPeer(reply.nodeId, reply.port, reply.config);
      return reply.peers;
    } finally {
      this.joining.delete(targetPort);
    }
  }

  /**
   * Sends JOIN to every lower port not already known, then to every node
   * mentioned in the replies, until no unknown nodes remain.
   */
  async probeLowerPorts(): Promise<Peer[]> {
    let targets: number[] = [];
    for (let port = BASE_PORT; port < this.self.port; port++) {
      if (!this.hasPort(port)) targets.push(port);
    }

    while (targets.length > 0) {
      const replies = await Promise.all(targets.map((port) => this.sendJoin(port)));
      const mentioned = new Set(replies.flat().map((peer) => peer.port));
      // Nodes that did not answer are skipped rather than retried.
      const tried = new Set(targets);
      targets = [...mentioned].filter(
        (port) => port !== this.self.port && !this.hasPort(port) && !tried.has(port),
      );
    }
    return [...this.peers.values()];
  }

  private hasPort(port: number): boolean {
    return [...this.peers.values()].some((peer) => peer.port === port);
  }

  /** Adds (or refreshes) the joining node and tells it who else is here. */
  handleJoin(message: JoinMessage): JoinResponse {
    this.addPeer(message.nodeId, message.port, message.config);
    const known = [...this.peers.values()]
      .filter((peer) => peer.nodeId !== message.nodeId)
      .map(({ nodeId, port }) => ({ nodeId, port }));
    return {
      type: "JOIN_RESPONSE",
      ...this.self,
      config: this.getConfig(),
      peers: [this.self, ...known],
    };
  }

  /**
   * Notes that a message arrived from `nodeId`. A sender we do not know (for
   * example one we timed out, or that took a free lower port) is joined so
   * both sides learn each other again.
   */
  recordContact(nodeId: string): void {
    const peer = this.peers.get(nodeId);
    if (peer) {
      peer.lastHeartbeat = Date.now();
      return;
    }
    const port = portFromNodeId(nodeId);
    if (port !== null && port !== this.self.port) void this.sendJoin(port);
  }

  isSuspected(peer: Peer, now = Date.now()): boolean {
    return now - peer.lastHeartbeat > PEER_SUSPECT_MS;
  }

  /** Removes peers that have been silent longer than PEER_TIMEOUT_MS. */
  private removeDeadPeers(): void {
    const now = Date.now();
    for (const peer of this.peers.values()) {
      if (now - peer.lastHeartbeat > PEER_TIMEOUT_MS) {
        this.peers.delete(peer.nodeId);
      }
    }
  }

  /** Sends JOIN to every peer again so they pick up this node's new configuration. */
  async announce(): Promise<void> {
    await this.broadcast(this.joinMessage());
  }

  /** Sends `message` to every known peer concurrently and collects the replies. */
  async broadcast<T = unknown>(message: Message): Promise<(T | null)[]> {
    return Promise.all([...this.peers.values()].map((peer) => sendMessage<T>(peer.port, message)));
  }

  /**
   * Every interval: sends a heartbeat to all peers, drops dead ones and probes
   * lower ports again for nodes that started in a gap. Returns a stop function.
   */
  startHeartbeat(buildHeartbeat: () => HeartbeatMessage, intervalMs: number): () => void {
    const timer = setInterval(() => {
      void this.broadcast(buildHeartbeat());
      this.removeDeadPeers();
      void this.probeLowerPorts();
    }, intervalMs);
    return () => clearInterval(timer);
  }
}
