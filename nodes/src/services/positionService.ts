import type { MembershipService } from "./membershipService";
import type { PositionMessage } from "./messages";

/**
 * Pushes this node's angle to every peer and keeps the latest angle received
 * from each peer, ordered by the sender's `seq`.
 */
export class PositionService {
  readonly positionCache = new Map<string, PositionMessage>();
  private seq = 0;

  constructor(
    private readonly nodeId: string,
    private readonly membership: MembershipService,
  ) {}

  broadcastPosition(angle: number): void {
    const message: PositionMessage = {
      type: "POSITION",
      pendulumId: this.nodeId,
      angle,
      seq: this.seq++,
    };
    void this.membership.broadcast(message);
  }

  /** Keeps the message only if it is newer than the cached one. */
  handlePosition(message: PositionMessage): void {
    const cached = this.positionCache.get(message.pendulumId);
    if (cached && message.seq <= cached.seq) return;
    this.positionCache.set(message.pendulumId, message);
  }

  /** Drops a peer's position, e.g. when it rejoins and restarts its `seq` from 0. */
  forget(nodeId: string): void {
    this.positionCache.delete(nodeId);
  }
}
