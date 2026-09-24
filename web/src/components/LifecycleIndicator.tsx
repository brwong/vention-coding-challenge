import { LIFECYCLE_COLORS } from '../pendulum'
import type { PendulumStatus, ProtocolStatus } from '../services/nodeState'

interface Props {
  status?: PendulumStatus
  protocol?: ProtocolStatus
  // Without a status: whether polling has failed, or simply hasn't answered yet.
  unreachable: boolean
}

/** What the node is doing about a collision stop, if anything. */
function coordinationDetail(status: PendulumStatus, protocol?: ProtocolStatus): string | undefined {
  if (status.lifecycle === 'restarting') return 'Restart countdown'
  if (status.lifecycle === 'stopped' && protocol?.awaitingRestart) {
    return `Waiting for RESTART (${protocol.restartBarrier.length}/${protocol.quorumSize})`
  }
  return undefined
}

export function LifecycleIndicator({ status, protocol, unreachable }: Props) {
  if (!status) {
    return unreachable ? (
      <span className="lifecycle error">Node unreachable</span>
    ) : (
      <span className="lifecycle muted">
        <span className="spinner" aria-hidden="true" />
        Connecting…
      </span>
    )
  }

  const color = LIFECYCLE_COLORS[status.lifecycle]
  const detail = coordinationDetail(status, protocol)
  return (
    <span className="lifecycle">
      <span className="lifecycle-dot" style={{ background: color }} aria-hidden="true" />
      <span style={{ color }}>{status.lifecycle}</span>
      {protocol?.isLeader && <span className="badge">leader</span>}
      {detail && <span className="lifecycle-detail">{detail}</span>}
    </span>
  )
}
