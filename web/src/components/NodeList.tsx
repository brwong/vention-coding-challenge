import { nodeColor } from '../pendulum'
import type { NodeInfo } from '../services/nodeDiscovery'
import type { LifecycleCommand, PendulumStatus, ProtocolStatus } from '../services/nodeState'
import { LifecycleIndicator } from './LifecycleIndicator'

const NODE_COMMANDS: { command: LifecycleCommand; label: string }[] = [
  { command: 'start', label: 'Start' },
  { command: 'pause', label: 'Pause' },
  { command: 'stop', label: 'Stop' },
]

interface Props {
  nodes: NodeInfo[]
  statuses: Map<string, PendulumStatus>
  protocols: Map<string, ProtocolStatus>
  unreachable: Set<string>
  selectedNodeId?: string
  // Nodes with a command in flight; their buttons are disabled until it settles.
  busyNodeIds: Set<string>
  onCommand: (node: NodeInfo, command: LifecycleCommand) => void
  onConfigure: (nodeId: string) => void
}

export function NodeList({
  nodes,
  statuses,
  protocols,
  unreachable,
  selectedNodeId,
  busyNodeIds,
  onCommand,
  onConfigure,
}: Props) {
  return (
    <div className="table-scroll">
      <table className="node-list">
        <thead>
          <tr>
            <th>Node</th>
            <th className="port">Port</th>
            <th>State</th>
            <th>
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {nodes.map((node) => {
            const status = statuses.get(node.nodeId)
            const disabled = !status || busyNodeIds.has(node.nodeId)
            // Configuring mid-play would edit a pendulum that's already moving.
            const configurable = status?.lifecycle === 'ready' || status?.lifecycle === 'stopped'
            return (
              <tr
                key={node.nodeId}
                className={node.nodeId === selectedNodeId ? 'selected' : undefined}
                aria-selected={node.nodeId === selectedNodeId}
              >
                <td className="node-id">
                  <span className="swatch" style={{ background: nodeColor(node.port) }} />
                  {node.nodeId}
                </td>
                <td className="muted port">{node.port}</td>
                <td>
                  <LifecycleIndicator
                    status={status}
                    protocol={protocols.get(node.nodeId)}
                    unreachable={node.status === 'inactive' || unreachable.has(node.nodeId)}
                  />
                </td>
                <td>
                  <div className="node-actions">
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
                      disabled={!configurable}
                      aria-label={`Configure ${node.nodeId}`}
                      onClick={() => onConfigure(node.nodeId)}
                    >
                      Configure
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
