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

// Always renders a detail line, even blank, so a row's height doesn't change
// depending on whether one is present (e.g. during a restart countdown).
export function LifecycleIndicator({ status, protocol, unreachable }: Props) {
  if (!status) {
    return (
      <span className="lifecycle">
        <span className="lifecycle-main">
          {unreachable ? (
            <span className="error">Node unreachable</span>
          ) : (
            <span className="muted">
              <span className="spinner" aria-hidden="true" />
              Connecting…
            </span>
          )}
        </span>
        <span className="lifecycle-detail">&nbsp;</span>
      </span>
    )
  }

  const color = LIFECYCLE_COLORS[status.lifecycle]
  const detail = coordinationDetail(status, protocol)
  return (
    <span className="lifecycle">
      <span className="lifecycle-main">
        <span className="lifecycle-dot" style={{ background: color }} aria-hidden="true" />
        <span style={{ color }}>{status.lifecycle}</span>
        {protocol?.isLeader && <span className="badge">leader</span>}
      </span>
      <span className="lifecycle-detail">{detail ?? <>&nbsp;</>}</span>
    </span>
  )
}
