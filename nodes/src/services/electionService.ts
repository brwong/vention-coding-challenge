import { portFromNodeId } from "../config";
import { ELECTION_CHECK_INTERVAL_MS, ELECTION_JITTER_MS, ELECTION_TIMEOUT_MS } from "../constants";
import { logEvent } from "../terminal";
import type { MembershipService } from "./membershipService";
import type { ElectionRequest, ElectionResponse, HeartbeatMessage } from "./messages";

export interface ElectionState {
  currentTerm: number;
  leaderId: string | null;
  isLeader: boolean;
  votedFor: string | null;
}

/** Orders node IDs by port, so `node-7704` outranks `node-7700`. */
export function compareNodeIds(a: string, b: string): number {
  const portA = portFromNodeId(a);
  const portB = portFromNodeId(b);
  if (portA !== null && portB !== null) return portA - portB;
  return a.localeCompare(b);
}

/**
 * Chooses the leader that decides STOP and RESTART. A follower that hears no
 * leader heartbeat for a while starts an election in a new term. Peers object
 * to a candidate they outrank and run for leader themselves, and a candidate
 * wins with a majority of votes and no objection, so the highest live node ID
 * ends up leading. Higher terms always win; within a term, higher IDs win.
 */
export class ElectionService {
  currentTerm = 0;
  leaderId: string | null = null;
  votedFor: string | null = null;
  private electing = false;
  private electionDeadline = 0;

  constructor(
    private readonly nodeId: string,
    private readonly membership: MembershipService,
  ) {
    this.resetElectionTimer();
  }

  get isLeader(): boolean {
    return this.leaderId === this.nodeId;
  }

  get state(): ElectionState {
    const { currentTerm, leaderId, isLeader, votedFor } = this;
    return { currentTerm, leaderId, isLeader, votedFor };
  }

  /** Waits a randomized timeout, so followers rarely start elections at once. */
  private resetElectionTimer(): void {
    this.electionDeadline = Date.now() + ELECTION_TIMEOUT_MS + Math.random() * ELECTION_JITTER_MS;
  }

  /**
   * Moves to a higher term, forgetting this term's vote and leader (stepping
   * down if this node led). Returns false when `term` is not newer.
   */
  adoptTerm(term: number, leaderId: string | null = null): boolean {
    if (term <= this.currentTerm) return false;
    this.currentTerm = term;
    this.votedFor = null;
    this.setLeader(leaderId);
    return true;
  }

  private setLeader(leaderId: string | null): void {
    if (leaderId !== null && leaderId !== this.leaderId) {
      const self = leaderId === this.nodeId ? " (this node)" : "";
      logEvent(`Elected leader: ${leaderId}${self} (term ${this.currentTerm})`);
    }
    this.leaderId = leaderId;
  }

  /** Starts a new term led by this node; used by the leader for each STOP. */
  bumpTerm(): number {
    this.currentTerm++;
    this.votedFor = this.nodeId;
    return this.currentTerm;
  }

  /**
   * The leader holds its lease while it hears from a majority of the cluster,
   * counting itself; peers silent long enough to be suspected do not count.
   */
  holdsLease(): boolean {
    if (!this.isLeader) return false;
    const peers = [...this.membership.peers.values()];
    const live = peers.filter((peer) => !this.membership.isSuspected(peer)).length;
    return live + 1 > (peers.length + 1) / 2;
  }

  heartbeat(): HeartbeatMessage {
    return {
      type: "HEARTBEAT",
      nodeId: this.nodeId,
      term: this.currentTerm,
      isLeader: this.isLeader,
    };
  }

  private async sendHeartbeat(): Promise<void> {
    await this.membership.broadcast(this.heartbeat());
  }

  /** Runs one election. Returns the leader known afterwards, if any. */
  async startElection(): Promise<string | null> {
    if (this.electing) return this.leaderId;
    this.electing = true;
    try {
      const term = ++this.currentTerm;
      this.votedFor = this.nodeId;
      this.leaderId = null;
      logEvent(`No leader heard from; starting election (term ${term})`);
      const clusterSize = this.membership.peers.size + 1;

      const request: ElectionRequest = { type: "ELECTION_REQUEST", nodeId: this.nodeId, term };
      const replies = (await this.membership.broadcast<ElectionResponse>(request)).filter(
        (reply): reply is ElectionResponse => reply?.type === "ELECTION_RESPONSE",
      );
      replies.forEach((reply) => this.handleElectionResponse(reply));
      // A newer term or a leader for this term appeared while we waited.
      if (this.currentTerm !== term || this.leaderId !== null) return this.leaderId;

      const current = replies.filter((reply) => reply.term === term);
      const outranked = current.some((r) => r.voteFor !== null && r.voteFor !== this.nodeId);
      const votes = 1 + current.filter((r) => r.voteFor === this.nodeId).length;
      if (!outranked && votes > clusterSize / 2) {
        this.setLeader(this.nodeId);
        void this.sendHeartbeat();
      }
      return this.leaderId;
    } finally {
      this.electing = false;
      this.resetElectionTimer();
    }
  }

  /**
   * Votes for the candidate unless this node outranks it or already backs a
   * higher candidate this term; `voteFor` names whoever this node backs.
   */
  handleElectionRequest(message: ElectionRequest): ElectionResponse {
    this.adoptTerm(message.term);
    const reply = (voteFor: string | null): ElectionResponse => ({
      type: "ELECTION_RESPONSE",
      nodeId: this.nodeId,
      term: this.currentTerm,
      voteFor,
    });

    if (message.term < this.currentTerm) return reply(null);

    if (compareNodeIds(this.nodeId, message.nodeId) > 0) {
      // Object, then claim leadership: reassert it if held, else run for it.
      setImmediate(() => void (this.isLeader ? this.sendHeartbeat() : this.startElection()));
      return reply(this.nodeId);
    }

    if (this.votedFor === null || compareNodeIds(message.nodeId, this.votedFor) > 0) {
      this.votedFor = message.nodeId;
    }
    return reply(this.votedFor);
  }

  /** A reply from a newer term means this node's term is stale. */
  handleElectionResponse(message: ElectionResponse): void {
    this.adoptTerm(message.term);
  }

  handleHeartbeat(message: HeartbeatMessage): void {
    this.adoptTerm(message.term, message.isLeader ? message.nodeId : null);
    if (!message.isLeader || message.term < this.currentTerm) return;
    // Two leaders in one term: the higher ID keeps it.
    if (this.isLeader && compareNodeIds(this.nodeId, message.nodeId) > 0) return;
    this.setLeader(message.nodeId);
    this.resetElectionTimer();
  }

  /** Starts an election whenever the leader has been silent too long. Returns a stop function. */
  startElectionTimer(): () => void {
    const timer = setInterval(() => {
      if (!this.isLeader && Date.now() > this.electionDeadline) void this.startElection();
    }, ELECTION_CHECK_INTERVAL_MS);
    return () => clearInterval(timer);
  }
}
