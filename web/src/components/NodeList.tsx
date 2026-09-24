import { LIFECYCLE_COLORS, UNREACHABLE_COLOR, nodeColor } from '../pendulum'
import type { NodeInfo } from '../services/nodeDiscovery'
import type { PendulumStatus } from '../services/nodeState'

interface Props {
  nodes: NodeInfo[]
  statuses: Map<string, PendulumStatus>
  lastUpdated: Map<string, number>
  selectedNodeId?: string
}

function formatTime(timestamp: number | undefined): string {
  return timestamp === undefined ? '—' : new Date(timestamp).toLocaleTimeString()
}

export function NodeList({ nodes, statuses, lastUpdated, selectedNodeId }: Props) {
  return (
    <table className="node-list">
      <thead>
        <tr>
          <th>Node</th>
          <th>Port</th>
          <th>State</th>
          <th>Last update</th>
        </tr>
      </thead>
      <tbody>
        {nodes.map((node) => {
          const status = statuses.get(node.nodeId)
          const state = status?.lifecycle ?? 'unreachable'
          const stateColor = status ? LIFECYCLE_COLORS[status.lifecycle] : UNREACHABLE_COLOR
          return (
            <tr
              key={node.nodeId}
              className={node.nodeId === selectedNodeId ? 'selected' : undefined}
              aria-selected={node.nodeId === selectedNodeId}
            >
              <td>
                <span className="swatch" style={{ background: nodeColor(node.port) }} />
                {node.nodeId}
              </td>
              <td className="muted">{node.port}</td>
              <td style={{ color: stateColor }}>{state}</td>
              <td className="muted">{formatTime(lastUpdated.get(node.nodeId))}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
