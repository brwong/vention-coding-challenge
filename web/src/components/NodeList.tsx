import { LIFECYCLE_COLORS, UNREACHABLE_COLOR, nodeColor } from '../pendulum'
import type { NodeInfo } from '../services/nodeDiscovery'
import type { LifecycleCommand, PendulumStatus } from '../services/nodeState'

const NODE_COMMANDS: { command: LifecycleCommand; label: string }[] = [
  { command: 'start', label: 'Start' },
  { command: 'pause', label: 'Pause' },
  { command: 'stop', label: 'Stop' },
]

interface Props {
  nodes: NodeInfo[]
  statuses: Map<string, PendulumStatus>
  lastUpdated: Map<string, number>
  selectedNodeId?: string
  // Nodes with a command in flight; their buttons are disabled until it settles.
  busyNodeIds: Set<string>
  onCommand: (node: NodeInfo, command: LifecycleCommand) => void
  onConfigure: (nodeId: string) => void
}

function formatTime(timestamp: number | undefined): string {
  return timestamp === undefined ? '—' : new Date(timestamp).toLocaleTimeString()
}

export function NodeList({
  nodes,
  statuses,
  lastUpdated,
  selectedNodeId,
  busyNodeIds,
  onCommand,
  onConfigure,
}: Props) {
  return (
    <table className="node-list">
      <thead>
        <tr>
          <th>Node</th>
          <th>Port</th>
          <th>State</th>
          <th>Last update</th>
          <th>
            <span className="visually-hidden">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {nodes.map((node) => {
          const status = statuses.get(node.nodeId)
          const state = status?.lifecycle ?? 'unreachable'
          const stateColor = status ? LIFECYCLE_COLORS[status.lifecycle] : UNREACHABLE_COLOR
          const disabled = !status || busyNodeIds.has(node.nodeId)
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
              <td className="node-actions">
                {NODE_COMMANDS.map(({ command, label }) => (
                  <button
                    key={command}
                    type="button"
                    disabled={disabled}
                    aria-label={`${label} ${node.nodeId}`}
                    onClick={() => onCommand(node, command)}
                  >
                    {label}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={!status}
                  aria-label={`Configure ${node.nodeId}`}
                  onClick={() => onConfigure(node.nodeId)}
                >
                  Configure
                </button>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
