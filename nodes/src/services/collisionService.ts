import { HINGE_Y } from "../constants";
import { type Bob, checkCollision } from "../physics";
import type { Simulation } from "../simulation";
import type { MembershipService, Peer } from "./membershipService";
import type { PositionService } from "./positionService";
import type { ProtocolService } from "./protocolService";

/**
 * Checks this node's bob against the latest known position of every peer and,
 * on a collision, has the protocol stop every node.
 */
export class CollisionService {
  constructor(
    private readonly simulation: Simulation,
    private readonly membership: MembershipService,
    private readonly position: PositionService,
    private readonly protocol: ProtocolService,
  ) {}

  /**
   * Returns the first peer whose bob touches ours, if any. Skips peers
   * suspected dead: a silent peer's cached position is frozen where it last
   * reported, so treating it as live risks a "ghost" collision with a bob
   * that has stopped moving rather than a real one.
   */
  findCollision(): Peer | null {
    const { config, state } = this.simulation;
    const local: Bob = {
      angle: state.angle,
      anchor: { x: config.x, y: HINGE_Y },
      length: config.length,
      mass: config.mass,
    };
    for (const peer of this.membership.peers.values()) {
      if (this.membership.isSuspected(peer)) continue;
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

  /**
   * Runs after every physics tick. Only a running pendulum reports collisions,
   * and reporting stops it, so one collision is reported once.
   */
  checkCollisions(): void {
    if (this.simulation.lifecycle !== "running") return;
    const peer = this.findCollision();
    if (peer) this.protocol.reportCollision(peer.nodeId);
  }
}
