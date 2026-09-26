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
const LENGTH_HANDLE_SIZE = 8
const ANGLE_HANDLE_RADIUS = 5
const MASS_HANDLE_SIZE = 8
// Where the angle and length handles sit along the rod, as a fraction of its length.
const ANGLE_HANDLE_FRACTION = 0.3
const LENGTH_HANDLE_FRACTION = 0.85
const TOOLTIP_FONT_SIZE = 7
const TOOLTIP_PADDING_X = 4
const TOOLTIP_PADDING_Y = 3
const TOOLTIP_GAP = 6 // space between a handle and its tooltip

type DragPart = 'hinge' | 'length' | 'angle' | 'mass'

const HANDLE_LABELS: Record<DragPart, string> = {
  hinge: 'Anchor position',
  angle: 'Initial angle',
  length: 'String length',
  mass: 'Mass (fixed density)',
}

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

/** Unit vector along the rod, from the hinge toward the bob. Angle 0 hangs straight down. */
function rodUnit(angle: number): Point {
  const rad = (angle * Math.PI) / 180
  return { x: Math.sin(rad), y: Math.cos(rad) }
}

/** The draft change a drag of `part` to `point` makes. Each part edits exactly one field. */
function dragChange(part: DragPart, point: Point, config: PendulumConfig): Partial<PendulumConfig> {
  const dx = point.x - config.x
  const dy = point.y - HINGE_Y
  switch (part) {
    case 'hinge':
      return { x: Math.round(point.x) }
    case 'angle':
      // Positive angle swings the bob toward +x.
      return { angle: round((Math.atan2(dx, dy) * 180) / Math.PI, 1) }
    case 'length': {
      const unit = rodUnit(config.angle)
      // Only movement along the rod's current direction changes its length.
      const projected = dx * unit.x + dy * unit.y
      const { min, max } = CONFIG_LIMITS.length
      return { length: Math.round(clamp(projected, min, max)) }
    }
    case 'mass': {
      const bob = bobPosition(config.x, config.length, (config.angle * Math.PI) / 180)
      const radius = Math.hypot(point.x - bob.x, point.y - bob.y)
      const { min, max } = CONFIG_LIMITS.mass
      return { mass: Math.round(clamp((4 / 3) * Math.PI * radius ** 3, min, max)) }
    }
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
          onLengthDown={(event) => startDrag('length', event)}
          onAngleDown={(event) => startDrag('angle', event)}
          onMassDown={(event) => startDrag('mass', event)}
        />
      )}
    </svg>
  )
}

interface DraftPendulumProps {
  config: PendulumConfig
  dragging?: DragPart
  onHingeDown: (event: PointerEvent<SVGElement>) => void
  onLengthDown: (event: PointerEvent<SVGElement>) => void
  onAngleDown: (event: PointerEvent<SVGElement>) => void
  onMassDown: (event: PointerEvent<SVGElement>) => void
}

/** The selected pendulum at its draft config, with a separate drag handle per field. */
function DraftPendulum({
  config,
  dragging,
  onHingeDown,
  onLengthDown,
  onAngleDown,
  onMassDown,
}: DraftPendulumProps) {
  const [hovered, setHovered] = useState<DragPart>()
  const active = dragging ?? hovered

  const unit = rodUnit(config.angle)
  const bob = bobPosition(config.x, config.length, (config.angle * Math.PI) / 180)
  const radius = bobRadius(config.mass)
  const angleHandle = {
    x: config.x + unit.x * config.length * ANGLE_HANDLE_FRACTION,
    y: HINGE_Y + unit.y * config.length * ANGLE_HANDLE_FRACTION,
  }
  const lengthHandle = {
    x: config.x + unit.x * config.length * LENGTH_HANDLE_FRACTION,
    y: HINGE_Y + unit.y * config.length * LENGTH_HANDLE_FRACTION,
  }
  // The far edge of the bob, away from the hinge, so it reads as a resize grip on the circle.
  const massHandle = { x: bob.x + unit.x * radius, y: bob.y + unit.y * radius }
  const handlePositions: Record<DragPart, Point> = {
    hinge: { x: config.x, y: HINGE_Y },
    angle: angleHandle,
    length: lengthHandle,
    mass: massHandle,
  }

  const handleClass = (part: DragPart, extra: string) =>
    dragging === part ? `handle ${extra} active` : `handle ${extra}`
  const hoverProps = (part: DragPart) => ({
    onPointerEnter: () => setHovered(part),
    onPointerLeave: () => setHovered((current) => (current === part ? undefined : current)),
  })

  return (
    <g className="draft">
      <line x1={config.x} y1={HINGE_Y} x2={bob.x} y2={bob.y} className="draft-rod" />
      <rect
        x={config.x - HINGE_HANDLE_SIZE / 2}
        y={HINGE_Y - HINGE_HANDLE_SIZE / 2}
        width={HINGE_HANDLE_SIZE}
        height={HINGE_HANDLE_SIZE}
        className={handleClass('hinge', 'hinge-handle')}
        aria-label={HANDLE_LABELS.hinge}
        onPointerDown={onHingeDown}
        {...hoverProps('hinge')}
      />
      <circle
        cx={angleHandle.x}
        cy={angleHandle.y}
        r={ANGLE_HANDLE_RADIUS}
        className={handleClass('angle', 'angle-handle')}
        aria-label={HANDLE_LABELS.angle}
        onPointerDown={onAngleDown}
        {...hoverProps('angle')}
      />
      <rect
        x={lengthHandle.x - LENGTH_HANDLE_SIZE / 2}
        y={lengthHandle.y - LENGTH_HANDLE_SIZE / 2}
        width={LENGTH_HANDLE_SIZE}
        height={LENGTH_HANDLE_SIZE}
        className={handleClass('length', 'length-handle')}
        aria-label={HANDLE_LABELS.length}
        onPointerDown={onLengthDown}
        {...hoverProps('length')}
      />
      <circle cx={bob.x} cy={bob.y} r={radius} className="draft-bob" />
      <rect
        x={massHandle.x - MASS_HANDLE_SIZE / 2}
        y={massHandle.y - MASS_HANDLE_SIZE / 2}
        width={MASS_HANDLE_SIZE}
        height={MASS_HANDLE_SIZE}
        className={handleClass('mass', 'mass-handle')}
        aria-label={HANDLE_LABELS.mass}
        onPointerDown={onMassDown}
        {...hoverProps('mass')}
      />
      {active && <HandleTooltip {...handlePositions[active]} text={HANDLE_LABELS[active]} />}
    </g>
  )
}

/** A small always-instant label near a handle, in place of a browser title's hover delay. */
function HandleTooltip({ x, y, text }: Point & { text: string }) {
  const width = text.length * TOOLTIP_FONT_SIZE * 0.62 + TOOLTIP_PADDING_X * 2
  const height = TOOLTIP_FONT_SIZE + TOOLTIP_PADDING_Y * 2
  return (
    <g className="handle-tooltip" transform={`translate(${x - width / 2}, ${y - height - TOOLTIP_GAP})`}>
      <rect width={width} height={height} rx={3} />
      <text x={width / 2} y={height / 2} fontSize={TOOLTIP_FONT_SIZE}>
        {text}
      </text>
    </g>
  )
}
