import { useEffect, useRef, useState } from 'react'
import { NodeConfigForm } from './components/NodeConfigForm'
import { NodeList } from './components/NodeList'
import { PendulumCanvas } from './components/PendulumCanvas'
import { OFF_WIND_DRAFT, WindControl, type WindDraft } from './components/WindControl'
import { type ConfigDraft, pruneDraft, resolveDraft } from './configDraft'
import { DEFAULT_AIR_DENSITY, DEFAULT_DRAG_COEFFICIENT } from './pendulum'
import { type NodeInfo, startPeriodicScan } from './services/nodeDiscovery'
import {
  type LifecycleCommand,
  type PendulumConfig,
  type PendulumStatus,
  type ProtocolStatus,
  RUNNING_POLL_INTERVAL_MS,
  applyConfig,
  disableWind,
  enableWind,
  pollNodeStates,
  pollProtocolStates,
  sendCommand,
} from './services/nodeState'

const COMMAND_VERBS: Record<LifecycleCommand, string> = {
  start: 'started',
  pause: 'paused',
  stop: 'stopped',
}

const GROUP_COMMANDS: { command: LifecycleCommand; label: string }[] = [
  { command: 'start', label: 'Start All' },
  { command: 'pause', label: 'Pause All' },
  { command: 'stop', label: 'Stop All' },
]

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** True when two scans found the same nodes, ignoring when each was last seen. */
function sameNodes(a: NodeInfo[], b: NodeInfo[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (node, i) =>
        node.nodeId === b[i].nodeId && node.status === b[i].status && node.x === b[i].x,
    )
  )
}

function App() {
  const [nodes, setNodes] = useState<NodeInfo[]>([])
  // True until the first scan finishes.
  const [scanning, setScanning] = useState(true)
  const [statuses, setStatuses] = useState(new Map<string, PendulumStatus>())
  const [unreachable, setUnreachable] = useState(new Set<string>())
  const [protocols, setProtocols] = useState(new Map<string, ProtocolStatus>())
  const [selectedNodeId, setSelectedNodeId] = useState<string>()
  // Unapplied edits, shared by the form and the canvas. They belong to one node
  // and are ignored once another node is selected.
  const [draft, setDraft] = useState<{ nodeId: string; fields: ConfigDraft }>()
  // Hidden while any node is playing or mid-restart; only an explicit Configure click brings it back.
  const [configVisible, setConfigVisible] = useState(true)
  const [actionMessage, setActionMessage] = useState<{ text: string; error: boolean }>()
  const [busy, setBusy] = useState(false)
  const [busyNodeIds, setBusyNodeIds] = useState(new Set<string>())
  // The UI, not any node, owns the displayed wind state; nodes only see PUT/DELETE /wind.
  const [windDraft, setWindDraft] = useState<WindDraft>(OFF_WIND_DRAFT)
  const [windApplying, setWindApplying] = useState(false)
  // A node whose config form should take focus once it has rendered.
  const pendingFocus = useRef<string>(undefined)
  // Bumping this restarts the polling right away.
  const [pollKey, setPollKey] = useState(0)

  useEffect(
    () =>
      startPeriodicScan((found) => {
        setScanning(false)
        // Keep the old array when nothing changed so polling isn't restarted.
        setNodes((previous) => (sameNodes(previous, found) ? previous : found))
      }),
    [],
  )

  useEffect(
    () =>
      pollNodeStates(nodes, RUNNING_POLL_INTERVAL_MS, (polled, failed) => {
        setStatuses(polled)
        setUnreachable(failed)
      }),
    [nodes, pollKey],
  )

  useEffect(() => pollProtocolStates(nodes, setProtocols), [nodes])

  // Also hide on a collision-triggered restart, which happens without going through
  // runGroupCommand/runNodeCommand and so wouldn't otherwise clear configVisible.
  useEffect(() => {
    const anyPlaying = [...statuses.values()].some(
      (status) => status.lifecycle === 'running' || status.lifecycle === 'restarting',
    )
    if (anyPlaying) setConfigVisible(false)
  }, [statuses])

  // Restarting is the existing simulation reset operation; each node clears its
  // own wind there, so the UI's displayed wind state must follow (docs/bonus-wind.md).
  useEffect(() => {
    const anyRestarting = [...statuses.values()].some((status) => status.lifecycle === 'restarting')
    if (anyRestarting) setWindDraft(OFF_WIND_DRAFT)
  }, [statuses])

  const activeNodes = nodes.filter((node) => node.status === 'active')

  async function runGroupCommand(command: LifecycleCommand) {
    if (command === 'start') setConfigVisible(false)
    setBusy(true)
    const results = await Promise.allSettled(
      activeNodes.map((node) => sendCommand(node.port, command)),
    )
    const failed = activeNodes.filter((_, i) => results[i].status === 'rejected')
    const succeeded = activeNodes.length - failed.length
    const counts = `${succeeded}/${activeNodes.length} nodes ${COMMAND_VERBS[command]}`
    const failedIds = failed.map((node) => node.nodeId).join(', ')
    if (failed.length === 0) {
      setActionMessage({ text: capitalize(counts), error: false })
    } else if (succeeded === 0) {
      setActionMessage({ text: `Failed: ${counts} (${failedIds} unreachable)`, error: true })
    } else {
      setActionMessage({ text: `Partial success: ${counts}; ${failedIds} failed`, error: true })
    }
    setBusy(false)
    // Poll now rather than wait out the idle interval, so the change shows at once.
    setPollKey((key) => key + 1)
  }

  // Sends the drafted wind setting to every active node. A per-node failure
  // (rejection, timeout, or unreachable node) is reported, never presented as applied.
  async function applyWind() {
    setWindApplying(true)
    const results = await Promise.allSettled(
      activeNodes.map((node) =>
        windDraft.enabled
          ? enableWind(node.port, {
              enabled: true,
              direction: windDraft.direction,
              speed: windDraft.speed,
              airDensity: DEFAULT_AIR_DENSITY,
              dragCoefficient: DEFAULT_DRAG_COEFFICIENT,
            })
          : disableWind(node.port),
      ),
    )
    const failed = activeNodes.filter((_, i) => results[i].status === 'rejected')
    const succeeded = activeNodes.length - failed.length
    const verb = windDraft.enabled ? 'enabled' : 'disabled'
    const counts = `Wind ${verb} on ${succeeded}/${activeNodes.length} nodes`
    const failedIds = failed.map((node) => node.nodeId).join(', ')
    if (failed.length === 0) {
      setActionMessage({ text: counts, error: false })
    } else if (succeeded === 0) {
      setActionMessage({ text: `Failed: ${counts} (${failedIds} unreachable)`, error: true })
    } else {
      setActionMessage({ text: `Partial success: ${counts}; ${failedIds} failed`, error: true })
    }
    setWindApplying(false)
  }

  async function runNodeCommand(node: NodeInfo, command: LifecycleCommand) {
    if (command === 'start') setConfigVisible(false)
    setBusyNodeIds((previous) => new Set(previous).add(node.nodeId))
    try {
      await sendCommand(node.port, command)
      setActionMessage({ text: `${node.nodeId} ${COMMAND_VERBS[command]}`, error: false })
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      setActionMessage({ text: `Failed to ${command} ${node.nodeId}: ${reason}`, error: true })
    }
    setBusyNodeIds((previous) => {
      const next = new Set(previous)
      next.delete(node.nodeId)
      return next
    })
    setPollKey((key) => key + 1)
  }

  function configure(nodeId: string) {
    setSelectedNodeId(nodeId)
    setConfigVisible(true)
    pendingFocus.current = nodeId
  }

  useEffect(() => {
    const nodeId = pendingFocus.current
    if (nodeId === undefined) return
    pendingFocus.current = undefined
    document.getElementById(`${nodeId}-x`)?.focus()
  })

  // Default to the first node, and drop a selection whose node is gone.
  const selectedNode = nodes.find((node) => node.nodeId === selectedNodeId) ?? nodes[0]
  const selected = selectedNode?.nodeId
  const selectedStatus = selected === undefined ? undefined : statuses.get(selected)
  const draftFields = draft && draft.nodeId === selected ? draft.fields : {}

  function updateDraft(fields: ConfigDraft) {
    if (!selectedStatus) return
    setDraft({ nodeId: selectedStatus.nodeId, fields: pruneDraft(selectedStatus.config, fields) })
  }

  function dragDraft(changes: Partial<PendulumConfig>) {
    const fields = { ...draftFields }
    for (const [field, value] of Object.entries(changes)) {
      fields[field as keyof ConfigDraft] = String(value)
    }
    updateDraft(fields)
  }

  async function applySelectedConfig(config: PendulumConfig) {
    await applyConfig(selectedNode.port, config)
    setPollKey((key) => key + 1)
  }

  return (
    <div className="app">
      <header>
        <h1>Pendulum</h1>
        <div className="controls">
          {GROUP_COMMANDS.map(({ command, label }) => (
            <button
              key={command}
              type="button"
              disabled={busy || activeNodes.length === 0}
              onClick={() => runGroupCommand(command)}
            >
              {label}
            </button>
          ))}
          <WindControl
            draft={windDraft}
            onChange={setWindDraft}
            onApply={applyWind}
            applying={windApplying}
            disabled={activeNodes.length === 0}
          />
        </div>
        {actionMessage && (
          <p
            className={actionMessage.error ? 'action-message error' : 'action-message'}
            role="status"
          >
            {actionMessage.text}
          </p>
        )}
      </header>
      {nodes.length === 0 ? (
        <p className="empty" role="status">
          {scanning ? (
            <>
              <span className="spinner" aria-hidden="true" />
              Scanning for nodes…
            </>
          ) : (
            'No nodes found'
          )}
        </p>
      ) : (
        <main>
          <PendulumCanvas
            nodes={nodes}
            statuses={statuses}
            unreachable={unreachable}
            selectedNodeId={selected}
            draftConfig={
              configVisible && selectedStatus ? resolveDraft(selectedStatus.config, draftFields) : undefined
            }
            onDraftChange={dragDraft}
            onSelect={setSelectedNodeId}
          />
          <aside>
            <NodeList
              nodes={nodes}
              statuses={statuses}
              protocols={protocols}
              unreachable={unreachable}
              selectedNodeId={selected}
              busyNodeIds={busyNodeIds}
              onCommand={runNodeCommand}
              onConfigure={configure}
            />
            {configVisible &&
              (selectedStatus ? (
                <NodeConfigForm
                  key={selected}
                  nodeId={selectedStatus.nodeId}
                  currentConfig={selectedStatus.config}
                  draft={draftFields}
                  onDraftChange={updateDraft}
                  onApply={applySelectedConfig}
                />
              ) : (
                selected && (
                  <p className="form-error">
                    {selected} is unreachable; its configuration cannot be edited.
                  </p>
                )
              ))}
          </aside>
        </main>
      )}
    </div>
  )
}

export default App
