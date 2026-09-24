import { portFromNodeId } from "../config";
import { HINGE_Y } from "../constants";
import { type Bob, checkCollision } from "../physics";
import type { Simulation } from "../simulation";
import { logEvent } from "../terminal";
import type { ElectionService } from "./electionService";
import type { MembershipService, Peer } from "./membershipService";
import { type CollisionDetectedMessage, sendMessage } from "./messages";
import type { PositionService } from "./positionService";

/**
 * Checks this node's bob against the latest known position of every peer and
 * reports a collision to the leader, at most once per term. It never stops
 * anything itself: the leader decides.
 */
export class CollisionService {
  private reportedTerm: number | null = null;

  constructor(
    private readonly nodeId: string,
    private readonly simulation: Simulation,
    private readonly membership: MembershipService,
    private readonly position: PositionService,
    private readonly election: ElectionService,
  ) {}

  /** Returns the first peer whose bob touches ours, if any. */
  findCollision(): Peer | null {
    const { config, state } = this.simulation;
    const local: Bob = {
      angle: state.angle,
      anchor: { x: config.x, y: HINGE_Y },
      length: config.length,
      mass: config.mass,
    };
    for (const peer of this.membership.peers.values()) {
      const latest = this.position.positionCache.get(peer.nodeId);
      if (!latest) continue;
      const other: Bob = {
        angle: latest.angle,
        anchor: { x: peer.config.x, y: HINGE_Y },
        length: peer.config.length,
        mass: peer.config.mass,
      };
      if (checkCollision(local, other)) return peer;
    }
    return null;
  }

  /** Runs after every physics tick. Only a running pendulum reports collisions. */
  checkCollisions(): void {
    if (this.simulation.lifecycle !== "running") return;
    const { currentTerm, leaderId } = this.election;
    // Without a leader, keep checking: one will be elected shortly.
    if (leaderId === null || this.reportedTerm === currentTerm) return;
    const peer = this.findCollision();
    if (!peer) return;

    const leaderPort = portFromNodeId(leaderId);
    if (leaderPort === null) return;
    this.reportedTerm = currentTerm;
    logEvent(`Collision detected with ${peer.nodeId}; reporting to leader ${leaderId}`);
    // The leader may be this node; it then handles the report like any other.
    void this.sendCollisionDetected(leaderPort, currentTerm);
  }

  async sendCollisionDetected(leaderPort: number, term: number): Promise<void> {
    const message: CollisionDetectedMessage = {
      type: "COLLISION_DETECTED",
      nodeId: this.nodeId,
      term,
    };
    await sendMessage(leaderPort, message);
  }
}
