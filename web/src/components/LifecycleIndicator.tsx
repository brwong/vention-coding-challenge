import { LIFECYCLE_COLORS, UNREACHABLE_COLOR } from '../pendulum'
import type { PendulumStatus, ProtocolStatus } from '../services/nodeState'

interface Props {
  status?: PendulumStatus
  protocol?: ProtocolStatus
}

/** What the node is doing about a collision stop, if anything. */
function coordinationDetail(status: PendulumStatus, protocol?: ProtocolStatus): string | undefined {
  if (status.lifecycle === 'restarting') return 'Restart countdown'
  if (status.lifecycle === 'stopped' && protocol?.awaitingRestart) {
    return `Waiting for RESTART (${protocol.restartBarrier.length}/${protocol.quorumSize})`
  }
  return undefined
}

export function LifecycleIndicator({ status, protocol }: Props) {
  const color = status ? LIFECYCLE_COLORS[status.lifecycle] : UNREACHABLE_COLOR
  const detail = status && coordinationDetail(status, protocol)
  return (
    <span className="lifecycle">
      <span className="lifecycle-dot" style={{ background: color }} aria-hidden="true" />
      <span style={{ color }}>{status?.lifecycle ?? 'unreachable'}</span>
      {protocol?.isLeader && <span className="badge">leader</span>}
      {detail && <span className="lifecycle-detail">{detail}</span>}
    </span>
  )
}
