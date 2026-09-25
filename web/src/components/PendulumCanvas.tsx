import { type KeyboardEvent, type PointerEvent, useRef, useState } from 'react'
import {
  CONFIG_LIMITS,
  HINGE_Y,
  LIFECYCLE_COLORS,
  LIFECYCLE_DASH,
  type Point,
  UNREACHABLE_COLOR,
  bobPosition,
  bobRadius,
  nodeColor,
} from '../pendulum'
import type { NodeInfo } from '../services/nodeDiscovery'
import type { PendulumConfig, PendulumStatus } from '../services/nodeState'

const PADDING = 20 // distance units around the outermost swing
const UNREACHABLE_REACH = 20 // space kept around a hinge with no known config
const HINGE_SIZE = 4
const HINGE_HANDLE_SIZE = 10

type DragPart = 'hinge' | 'bob'

interface Props {
  nodes: NodeInfo[]
  statuses: Map<string, PendulumStatus>
  unreachable: Set<string>
  selectedNodeId?: string
  // The selected node's config with the unapplied edits laid over it.
  draftConfig?: PendulumConfig
  onDraftChange: (changes: Partial<PendulumConfig>) => void
  onSelect: (nodeId: string) => void
}

/** A pendulum can swing a full circle, so reserve that whole circle for it. */
function reach(config: PendulumConfig | undefined): number {
  if (!config) return UNREACHABLE_REACH
  return config.length + bobRadius(config.mass)
}

function hingeX(node: NodeInfo, status: PendulumStatus | undefined): number {
  return status?.config.x ?? node.x ?? 0
}

function viewBox(
  nodes: NodeInfo[],
  statuses: Map<string, PendulumStatus>,
  draftConfig: PendulumConfig | undefined,
): string {
  const extents = nodes.map((node) => {
    const status = statuses.get(node.nodeId)
    return { x: hingeX(node, status), r: reach(status?.config) }
  })
  if (draftConfig) extents.push({ x: draftConfig.x, r: reach(draftConfig) })

  let minX = Infinity
  let maxX = -Infinity
  let maxReach = 0
  for (const { x, r } of extents) {
    minX = Math.min(minX, x - r)
    maxX = Math.max(maxX, x + r)
    maxReach = Math.max(maxReach, r)
  }
  const left = minX - PADDING
  const top = HINGE_Y - maxReach - PADDING
  return `${left} ${top} ${maxX + PADDING - left} ${2 * (maxReach + PADDING)}`
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const round = (value: number, places: number) => Number(value.toFixed(places))

/** The draft change a drag of `part` to `point` makes. */
function dragChange(part: DragPart, point: Point, config: PendulumConfig): Partial<PendulumConfig> {
  if (part === 'hinge') return { x: Math.round(point.x) }
  const dx = point.x - config.x
  const dy = point.y - HINGE_Y
  const { min, max } = CONFIG_LIMITS.length
  return {
    length: Math.round(clamp(Math.hypot(dx, dy), min, max)),
    // Angle 0 hangs straight down and positive swings toward +x.
    angle: round((Math.atan2(dx, dy) * 180) / Math.PI, 1),
  }
}

export function PendulumCanvas({
  nodes,
  statuses,
  unreachable,
  selectedNodeId,
  draftConfig,
  onDraftChange,
  onSelect,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  // Hold the viewBox still while dragging so the scene doesn't rescale under the pointer.
  const [drag, setDrag] = useState<{ part: DragPart; viewBox: string }>()

  if (nodes.length === 0) return null

  const currentViewBox = drag?.viewBox ?? viewBox(nodes, statuses, draftConfig)

  function toSvgPoint(event: PointerEvent): Point | undefined {
    const matrix = svgRef.current?.getScreenCTM()
    if (!matrix) return undefined
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
    return { x: point.x, y: point.y }
  }

  function startDrag(part: DragPart, event: PointerEvent<SVGElement>) {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({ part, viewBox: currentViewBox })
  }

  function moveDrag(event: PointerEvent) {
    if (!drag || !draftConfig) return
    const point = toSvgPoint(event)
    if (point) onDraftChange(dragChange(drag.part, point, draftConfig))
  }

  const endDrag = () => setDrag(undefined)

  return (
    <svg
      ref={svgRef}
      className={drag ? 'pendulum-canvas dragging' : 'pendulum-canvas'}
      viewBox={currentViewBox}
      role="group"
      aria-label="Pendulums"
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {/* Visual only: the rail the hinges are mounted to. */}
      <line x1={-100000} x2={100000} y1={HINGE_Y} y2={HINGE_Y} className="hinge-rail" />
      {nodes.map((node) => {
        const status = statuses.get(node.nodeId)
        const x = hingeX(node, status)
        const selected = node.nodeId === selectedNodeId
        // Each pendulum is a tab stop that selects its node on click, Enter or Space.
        const selectable = {
          tabIndex: 0,
          role: 'button',
          'aria-label': `Select ${node.nodeId}`,
          'aria-pressed': selected,
          onClick: () => onSelect(node.nodeId),
          onKeyDown: (event: KeyboardEvent) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            onSelect(node.nodeId)
          },
        }
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
          const lost = node.status === 'inactive' || unreachable.has(node.nodeId)
          return (
            <g key={node.nodeId} className="pendulum unreachable" opacity={0.6} {...selectable}>
              {hinge}
              <text x={x} y={HINGE_Y - 8} textAnchor="middle" className="label">
                {node.nodeId} ({lost ? 'unreachable' : 'connecting…'})
              </text>
            </g>
          )
        }

        const { length, mass } = status.config
        const bob = bobPosition(x, length, status.state.angle)
        const radius = bobRadius(mass)
        return (
          <g
            key={node.nodeId}
            className={selected ? 'pendulum selected' : 'pendulum'}
            {...selectable}
          >
            <line x1={x} y1={HINGE_Y} x2={bob.x} y2={bob.y} className="rod" />
            {hinge}
            <circle
              cx={bob.x}
              cy={bob.y}
              r={radius}
              fill={nodeColor(node.port)}
              stroke={LIFECYCLE_COLORS[status.lifecycle] ?? UNREACHABLE_COLOR}
              strokeWidth={selected ? 3 : 2}
              strokeDasharray={LIFECYCLE_DASH[status.lifecycle]}
            />
            <text x={x} y={HINGE_Y - 8} textAnchor="middle" className="label">
              {node.nodeId}
            </text>
          </g>
        )
      })}
      {draftConfig && (
        <DraftPendulum
          config={draftConfig}
          dragging={drag?.part}
          onHingeDown={(event) => startDrag('hinge', event)}
          onBobDown={(event) => startDrag('bob', event)}
        />
      )}
    </svg>
  )
}

interface DraftPendulumProps {
  config: PendulumConfig
  dragging?: DragPart
  onHingeDown: (event: PointerEvent<SVGElement>) => void
  onBobDown: (event: PointerEvent<SVGElement>) => void
}

/** The selected pendulum at its draft config and initial angle, with draggable hinge and bob. */
function DraftPendulum({ config, dragging, onHingeDown, onBobDown }: DraftPendulumProps) {
  const bob = bobPosition(config.x, config.length, (config.angle * Math.PI) / 180)
  return (
    <g className="draft">
      <line x1={config.x} y1={HINGE_Y} x2={bob.x} y2={bob.y} className="draft-rod" />
      <rect
        x={config.x - HINGE_HANDLE_SIZE / 2}
        y={HINGE_Y - HINGE_HANDLE_SIZE / 2}
        width={HINGE_HANDLE_SIZE}
        height={HINGE_HANDLE_SIZE}
        className={dragging === 'hinge' ? 'handle hinge-handle active' : 'handle hinge-handle'}
        onPointerDown={onHingeDown}
      >
        <title>Drag to move the hinge</title>
      </rect>
      <circle
        cx={bob.x}
        cy={bob.y}
        r={bobRadius(config.mass)}
        className={dragging === 'bob' ? 'handle bob-handle active' : 'handle bob-handle'}
        onPointerDown={onBobDown}
      >
        <title>Drag to set the length and initial angle</title>
      </circle>
    </g>
  )
}
