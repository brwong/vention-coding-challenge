import { compareNodeIds } from "../config";
import {
  RESTART_BARRIER_TIMEOUT_MS,
  RESTART_DELAY_MS,
  STOP_TO_RESTART_DELAY_MS,
} from "../constants";
import type { Lifecycle, Simulation } from "../simulation";
import { logEvent } from "../terminal";
import type { MembershipService } from "./membershipService";
import type { HeartbeatMessage, RestartMessage, StopMessage } from "./messages";

export interface CoordinationState {
  epoch: number; // newest stop epoch this node knows of
  lifecycle: Lifecycle;
  restartBarrier: Set<string>; // nodes that sent RESTART for the current stop
  awaitingRestart: boolean; // stopped by the protocol and the RESTART barrier is still open
  quorumSize: number; // RESTART senders needed before the countdown starts
  stoppedBy: string | null; // node whose collision caused the current stop
}

/**
 * The STOP/RESTART state machine, with no leader. A node that detects a
 * collision starts a new epoch (one past the newest it knows of) and
 * broadcasts STOP. Every node that stops, whether it detected the collision or
 * heard about it, holds still briefly, broadcasts RESTART once and waits for
 * RESTART from every live node (or the barrier timeout), then resets its
 * pendulum and resumes 5 seconds later. Two nodes that detect the same collision pick the same epoch,
 * so their STOPs merge into one stop. Messages from older epochs, and repeats,
 * are ignored.
 */
export class ProtocolService {
  private epoch = 0; // newest epoch seen in any STOP, RESTART or heartbeat
  private readonly restartBarrier = new Set<string>();
  private stoppedEpoch = 0; // epoch of the latest stop this node obeyed
  private restartedEpoch = 0; // epoch of the latest stop whose barrier completed
  private stoppedBy: string | null = null; // lowest-ID reporter of the latest stop
  private sendRestartTimer: NodeJS.Timeout | undefined;
  private barrierTimer: NodeJS.Timeout | undefined;
  private restartTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly nodeId: string,
    private readonly simulation: Simulation,
    private readonly membership: MembershipService,
  ) {}

  /** Every node that is not suspected dead, including this one. */
  get quorumSize(): number {
    const peers = [...this.membership.peers.values()];
    return peers.filter((peer) => !this.membership.isSuspected(peer)).length + 1;
  }

  get state(): CoordinationState {
    return {
      epoch: this.epoch,
      lifecycle: this.simulation.lifecycle,
      restartBarrier: new Set(this.restartBarrier),
      awaitingRestart: this.stoppedEpoch > this.restartedEpoch,
      quorumSize: this.quorumSize,
      stoppedBy: this.stoppedBy,
    };
  }

  heartbeat(): HeartbeatMessage {
    return { type: "HEARTBEAT", nodeId: this.nodeId, epoch: this.epoch };
  }

  /**
   * Heartbeats carry the sender's epoch, so a node that joined late or missed
   * a stop still picks a new epoch the others will obey.
   */
  handleHeartbeat(message: HeartbeatMessage): void {
    this.epoch = Math.max(this.epoch, message.epoch);
  }

  /** This node detected a collision: stop everyone under a new epoch. */
  reportCollision(peerId: string): void {
    const epoch = this.epoch + 1;
    logEvent(`Collision detected with ${peerId}; broadcasting STOP (epoch ${epoch})`);
    void this.membership.broadcast({
      type: "STOP",
      epoch,
      from: this.nodeId,
      reporter: this.nodeId,
    });
    this.enterStopped(epoch, this.nodeId);
  }

  handleStop(message: StopMessage): void {
    if (message.epoch <= this.stoppedEpoch) {
      // Another report of the latest stop; anything older is stale.
      if (message.epoch === this.stoppedEpoch && this.stoppedEpoch > 0) {
        this.noteReporter(message.reporter);
      }
      return;
    }
    // A heartbeat may already have carried this epoch, so only a strictly
    // older one is stale.
    if (message.epoch < this.epoch) return;
    logEvent(`STOP received from ${message.from} (epoch ${message.epoch}), stopping simulation`);
    this.enterStopped(message.epoch, message.reporter);
  }

  /**
   * When both colliding nodes report the same stop, every node keeps the
   * lower ID, so they all agree on one reporter.
   */
  private noteReporter(reporter: string): void {
    if (this.stoppedBy === null || compareNodeIds(reporter, this.stoppedBy) < 0) {
      this.stoppedBy = reporter;
    }
  }

  /**
   * Halts the pendulum and opens the barrier, then sends this node's RESTART
   * after STOP_TO_RESTART_DELAY_MS. Without the pause the barrier would
   * complete within milliseconds and reset the pendulum before anyone could
   * see where it stopped.
   */
  private enterStopped(epoch: number, reporter: string | null): void {
    this.epoch = Math.max(this.epoch, epoch);
    this.stoppedEpoch = epoch;
    this.stoppedBy = reporter;
    this.simulation.stop();
    clearTimeout(this.sendRestartTimer);
    clearTimeout(this.restartTimer);
    clearTimeout(this.barrierTimer);
    this.restartBarrier.clear();
    this.sendRestartTimer = setTimeout(() => this.sendRestart(epoch), STOP_TO_RESTART_DELAY_MS);
    // Proceed with whoever has answered if some RESTART never arrives.
    this.barrierTimer = setTimeout(
      () => this.completeBarrier(epoch),
      STOP_TO_RESTART_DELAY_MS + RESTART_BARRIER_TIMEOUT_MS,
    );
  }

  private sendRestart(epoch: number): void {
    this.restartBarrier.add(this.nodeId);
    logEvent(
      `Sending RESTART (epoch ${epoch}); waiting for RESTART from ${this.quorumSize} nodes`,
    );
    void this.membership.broadcast({ type: "RESTART", epoch, from: this.nodeId });
    this.checkBarrier(epoch);
  }

  handleRestart(message: RestartMessage): void {
    if (message.epoch < this.epoch) return;
    if (message.epoch > this.stoppedEpoch) {
      // This RESTART overtook its STOP; the STOP, when it arrives, fills in the reporter.
      logEvent(`RESTART received before STOP (epoch ${message.epoch}), stopping simulation`);
      this.enterStopped(message.epoch, null);
    }
    if (message.epoch <= this.restartedEpoch) return;
    this.restartBarrier.add(message.from);
    this.checkBarrier(message.epoch);
  }

  private checkBarrier(epoch: number): void {
    if (this.restartBarrier.size >= this.quorumSize) this.completeBarrier(epoch);
  }

  /** Resets the pendulum now, so peers see its start position, and resumes after RESTART_DELAY_MS. */
  private completeBarrier(epoch: number): void {
    if (epoch !== this.stoppedEpoch || epoch <= this.restartedEpoch) return;
    this.restartedEpoch = epoch;
    clearTimeout(this.barrierTimer);
    const heard = `${this.restartBarrier.size}/${this.quorumSize}`;
    const outcome = this.restartBarrier.size >= this.quorumSize ? "satisfied" : "timed out";
    logEvent(
      `RESTART barrier ${outcome} (${heard} nodes, epoch ${epoch}), restarting in ${RESTART_DELAY_MS / 1000}s`,
    );
    this.simulation.beginRestart();
    this.restartTimer = setTimeout(() => {
      // The UI may have paused or stopped the node during the countdown.
      if (this.simulation.lifecycle !== "restarting") return;
      this.simulation.start();
      logEvent(`Simulation restarted (epoch ${epoch})`);
    }, RESTART_DELAY_MS);
  }

  /** Clears pending timers on shutdown. */
  dispose(): void {
    clearTimeout(this.sendRestartTimer);
    clearTimeout(this.barrierTimer);
    clearTimeout(this.restartTimer);
  }
}
