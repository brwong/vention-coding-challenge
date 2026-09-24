import {
  HINGE_Y,
  LIFECYCLE_COLORS,
  UNREACHABLE_COLOR,
  bobPosition,
  bobRadius,
  nodeColor,
} from '../pendulum'
import type { NodeInfo } from '../services/nodeDiscovery'
import type { PendulumStatus } from '../services/nodeState'

const PADDING = 20 // distance units around the outermost swing
const UNREACHABLE_REACH = 20 // space kept around a hinge with no known config
const HINGE_SIZE = 4

interface Props {
  nodes: NodeInfo[]
  statuses: Map<string, PendulumStatus>
  selectedNodeId?: string
}

/** A pendulum can swing a full circle, so reserve that whole circle for it. */
function reach(status: PendulumStatus | undefined): number {
  if (!status) return UNREACHABLE_REACH
  return status.config.length + bobRadius(status.config.mass)
}

function hingeX(node: NodeInfo, status: PendulumStatus | undefined): number {
  return status?.config.x ?? node.x ?? 0
}

function viewBox(nodes: NodeInfo[], statuses: Map<string, PendulumStatus>): string {
  let minX = Infinity
  let maxX = -Infinity
  let maxReach = 0
  for (const node of nodes) {
    const status = statuses.get(node.nodeId)
    const x = hingeX(node, status)
    const r = reach(status)
    minX = Math.min(minX, x - r)
    maxX = Math.max(maxX, x + r)
    maxReach = Math.max(maxReach, r)
  }
  const left = minX - PADDING
  const top = HINGE_Y - maxReach - PADDING
  return `${left} ${top} ${maxX + PADDING - left} ${2 * (maxReach + PADDING)}`
}

export function PendulumCanvas({ nodes, statuses, selectedNodeId }: Props) {
  if (nodes.length === 0) return null

  return (
    <svg className="pendulum-canvas" viewBox={viewBox(nodes, statuses)} role="img" aria-label="Pendulums">
      {nodes.map((node) => {
        const status = statuses.get(node.nodeId)
        const x = hingeX(node, status)
        const selected = node.nodeId === selectedNodeId
        const hinge = (
          <rect
            x={x - HINGE_SIZE / 2}
            y={HINGE_Y - HINGE_SIZE / 2}
            width={HINGE_SIZE}
            height={HINGE_SIZE}
            className="hinge"
          />
        )

        if (!status) {
          return (
            <g key={node.nodeId} className="pendulum unreachable" opacity={0.6}>
              {hinge}
              <text x={x} y={HINGE_Y - 8} textAnchor="middle" className="label">
                {node.nodeId} (unreachable)
              </text>
            </g>
          )
        }

        const { length, mass } = status.config
        const bob = bobPosition(x, length, status.state.angle)
        const radius = bobRadius(mass)
        return (
          <g key={node.nodeId} className={selected ? 'pendulum selected' : 'pendulum'}>
            <line x1={x} y1={HINGE_Y} x2={bob.x} y2={bob.y} className="rod" />
            {hinge}
            <circle
              cx={bob.x}
              cy={bob.y}
              r={radius}
              fill={nodeColor(node.port)}
              stroke={LIFECYCLE_COLORS[status.lifecycle] ?? UNREACHABLE_COLOR}
              strokeWidth={selected ? 3 : 2}
            />
            <text x={x} y={HINGE_Y - 8} textAnchor="middle" className="label">
              {node.nodeId}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
