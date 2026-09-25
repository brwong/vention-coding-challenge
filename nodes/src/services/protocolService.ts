import { setTimeout as delay } from "node:timers/promises";
import {
  RESTART_BARRIER_TIMEOUT_MS,
  RESTART_DELAY_MS,
  STOP_TO_RESTART_DELAY_MS,
} from "../constants";
import type { Lifecycle, Simulation } from "../simulation";
import { logEvent } from "../terminal";
import type { ElectionService } from "./electionService";
import type { MembershipService } from "./membershipService";
import type { CollisionDetectedMessage, RestartMessage, StopMessage } from "./messages";

export interface CoordinationState {
  currentTerm: number;
  lifecycle: Lifecycle;
  leaderId: string | null;
  restartBarrier: Set<string>; // nodes that sent RESTART for the current stop
  awaitingRestart: boolean; // stopped by the protocol and the RESTART barrier is still open
  quorumSize: number; // RESTART senders needed before the countdown starts
  stoppedBy: string | null; // node whose collision report caused the current stop
}

/**
 * The STOP/RESTART state machine. On a collision report the leader starts a
 * new term, broadcasts STOP and then RESTART. Every node echoes RESTART to
 * all peers once, and when RESTART has arrived from every live node (or the
 * barrier times out) it resets its pendulum and resumes 5 seconds later.
 * Messages from older terms, and repeats, are ignored.
 */
export class ProtocolService {
  private readonly restartBarrier = new Set<string>();
  private stoppedTerm = 0; // term of the latest STOP this node obeyed
  private restartedTerm = 0; // term of the latest stop whose barrier completed
  private stoppedBy: string | null = null; // reporter carried by the latest STOP this node obeyed
  private barrierTimer: NodeJS.Timeout | undefined;
  private restartTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly nodeId: string,
    private readonly simulation: Simulation,
    private readonly membership: MembershipService,
    private readonly election: ElectionService,
  ) {}

  /** Every node that is not suspected dead, including this one. */
  get quorumSize(): number {
    const peers = [...this.membership.peers.values()];
    return peers.filter((peer) => !this.membership.isSuspected(peer)).length + 1;
  }

  get state(): CoordinationState {
    return {
      currentTerm: this.election.currentTerm,
      lifecycle: this.simulation.lifecycle,
      leaderId: this.election.leaderId,
      restartBarrier: new Set(this.restartBarrier),
      awaitingRestart: this.stoppedTerm > this.restartedTerm,
      quorumSize: this.quorumSize,
      stoppedBy: this.stoppedBy,
    };
  }

  /** Leader only: turns a collision report for the current term into STOP then RESTART. */
  handleCollisionDetected(message: CollisionDetectedMessage): { accepted: boolean } {
    if (!this.election.holdsLease() || message.term !== this.election.currentTerm) {
      return { accepted: false };
    }
    const term = this.election.bumpTerm();
    logEvent(`Collision reported by ${message.nodeId}; broadcasting STOP (term ${term})`);
    this.enterStopped(term, message.nodeId);
    void this.stopThenRestart(term, message.nodeId);
    return { accepted: true };
  }

  private async stopThenRestart(term: number, reporter: string): Promise<void> {
    await this.broadcastStop(term, reporter);
    await delay(STOP_TO_RESTART_DELAY_MS);
    // Leadership may have moved on; the barrier timeout then restarts everyone.
    if (this.election.isLeader && this.election.currentTerm === term) {
      this.handleRestart({ type: "RESTART", term, from: this.nodeId });
    }
  }

  async broadcastStop(term: number, reporter: string): Promise<void> {
    await this.membership.broadcast({ type: "STOP", term, from: this.nodeId, reporter });
  }

  async broadcastRestart(term: number): Promise<void> {
    await this.membership.broadcast({ type: "RESTART", term, from: this.nodeId });
  }

  handleStop(message: StopMessage): void {
    // A heartbeat may already have carried the new term, so compare against
    // the last STOP obeyed as well as the current term.
    if (message.term < this.election.currentTerm || message.term <= this.stoppedTerm) return;
    this.election.adoptTerm(message.term, message.from);
    logEvent(`STOP received from ${message.from} (term ${message.term}), stopping simulation`);
    this.enterStopped(message.term, message.reporter);
  }

  private enterStopped(term: number, reporter: string | null): void {
    this.stoppedTerm = term;
    this.stoppedBy = reporter;
    this.simulation.stop();
    this.restartBarrier.clear();
    clearTimeout(this.restartTimer);
    clearTimeout(this.barrierTimer);
    // Proceed with whoever has answered if some RESTART never arrives.
    this.barrierTimer = setTimeout(() => this.completeBarrier(term), RESTART_BARRIER_TIMEOUT_MS);
  }

  handleRestart(message: RestartMessage): void {
    if (message.term < this.election.currentTerm) return;
    if (message.term > this.stoppedTerm) {
      // This RESTART overtook its STOP.
      this.election.adoptTerm(message.term);
      logEvent(`RESTART received before STOP (term ${message.term}), stopping simulation`);
      // The reporter is unknown here; a STOP for this term, if it still arrives, is now too late to update it.
      this.enterStopped(message.term, null);
    }
    if (message.term <= this.restartedTerm) return;

    // Send our own RESTART the first time we see one for this term.
    const echo = !this.restartBarrier.has(this.nodeId);
    this.restartBarrier.add(message.from);
    if (echo) {
      logEvent(
        `Sending RESTART (term ${message.term}); waiting for RESTART from ${this.quorumSize} nodes`,
      );
      this.restartBarrier.add(this.nodeId);
      void this.broadcastRestart(message.term);
    }
    if (this.restartBarrier.size >= this.quorumSize) this.completeBarrier(message.term);
  }

  /** Resets the pendulum now, so peers see its start position, and resumes after RESTART_DELAY_MS. */
  private completeBarrier(term: number): void {
    if (term !== this.stoppedTerm || term <= this.restartedTerm) return;
    this.restartedTerm = term;
    clearTimeout(this.barrierTimer);
    const heard = `${this.restartBarrier.size}/${this.quorumSize}`;
    const outcome = this.restartBarrier.size >= this.quorumSize ? "satisfied" : "timed out";
    logEvent(
      `RESTART barrier ${outcome} (${heard} nodes, term ${term}), restarting in ${RESTART_DELAY_MS / 1000}s`,
    );
    this.simulation.beginRestart();
    this.restartTimer = setTimeout(() => {
      // The UI may have paused or stopped the node during the countdown.
      if (this.simulation.lifecycle !== "restarting") return;
      this.simulation.start();
      logEvent(`Simulation restarted (term ${term})`);
    }, RESTART_DELAY_MS);
  }

  /** Clears pending timers on shutdown. */
  dispose(): void {
    clearTimeout(this.barrierTimer);
    clearTimeout(this.restartTimer);
  }
}
