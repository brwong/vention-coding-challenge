import { useEffect, useRef, useState } from 'react'
import { NodeConfigForm } from './components/NodeConfigForm'
import { NodeList } from './components/NodeList'
import { NodeSelector } from './components/NodeSelector'
import { PendulumCanvas } from './components/PendulumCanvas'
import { type ConfigDraft, pruneDraft, resolveDraft } from './configDraft'
import { type NodeInfo, startPeriodicScan } from './services/nodeDiscovery'
import {
  type LifecycleCommand,
  type PendulumConfig,
  type PendulumStatus,
  type ProtocolStatus,
  RUNNING_POLL_INTERVAL_MS,
  applyConfig,
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
  // True until a scan finishes, whether the first one or one asked for by Refresh.
  const [scanning, setScanning] = useState(true)
  const [statuses, setStatuses] = useState(new Map<string, PendulumStatus>())
  const [unreachable, setUnreachable] = useState(new Set<string>())
  const [protocols, setProtocols] = useState(new Map<string, ProtocolStatus>())
  const [lastUpdated, setLastUpdated] = useState(new Map<string, number>())
  const [selectedNodeId, setSelectedNodeId] = useState<string>()
  // Unapplied edits, shared by the form and the canvas. They belong to one node
  // and are ignored once another node is selected.
  const [draft, setDraft] = useState<{ nodeId: string; fields: ConfigDraft }>()
  const [actionMessage, setActionMessage] = useState<{ text: string; error: boolean }>()
  const [busy, setBusy] = useState(false)
  const [busyNodeIds, setBusyNodeIds] = useState(new Set<string>())
  // A node whose config form should take focus once it has rendered.
  const pendingFocus = useRef<string>(undefined)
  // Bumping these restarts the scan or the polling right away.
  const [scanKey, setScanKey] = useState(0)
  const [pollKey, setPollKey] = useState(0)

  useEffect(
    () =>
      startPeriodicScan((found) => {
        setScanning(false)
        // Keep the old array when nothing changed so polling isn't restarted.
        setNodes((previous) => (sameNodes(previous, found) ? previous : found))
      }),
    [scanKey],
  )

  useEffect(
    () =>
      pollNodeStates(nodes, RUNNING_POLL_INTERVAL_MS, (polled, failed) => {
        setStatuses(polled)
        setUnreachable(failed)
        setLastUpdated((previous) => {
          const next = new Map(previous)
          const now = Date.now()
          for (const nodeId of polled.keys()) next.set(nodeId, now)
          return next
        })
      }),
    [nodes, pollKey],
  )

  useEffect(() => pollProtocolStates(nodes, setProtocols), [nodes])

  const activeNodes = nodes.filter((node) => node.status === 'active')
  // Nodes that missed the latest election may name an old leader; trust the newest term.
  const newest = [...protocols.values()].reduce<ProtocolStatus | undefined>(
    (best, protocol) => (best && best.term >= protocol.term ? best : protocol),
    undefined,
  )

  async function runGroupCommand(command: LifecycleCommand) {
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

  function refresh() {
    setScanning(true)
    setScanKey((key) => key + 1)
  }

  async function runNodeCommand(node: NodeInfo, command: LifecycleCommand) {
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
          <button type="button" disabled={scanning} onClick={refresh}>
            {scanning ? 'Scanning…' : 'Refresh Nodes'}
          </button>
        </div>
        {newest && (
          <p className="leader">
            {newest.leader ? `Leader: ${newest.leader}` : 'No leader elected'} (term {newest.term})
          </p>
        )}
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
            draftConfig={selectedStatus && resolveDraft(selectedStatus.config, draftFields)}
            onDraftChange={dragDraft}
            onSelect={setSelectedNodeId}
          />
          <aside>
            <NodeSelector nodes={nodes} selectedNodeId={selected} onSelect={setSelectedNodeId} />
            <NodeList
              nodes={nodes}
              statuses={statuses}
              protocols={protocols}
              unreachable={unreachable}
              lastUpdated={lastUpdated}
              selectedNodeId={selected}
              busyNodeIds={busyNodeIds}
              onCommand={runNodeCommand}
              onConfigure={configure}
            />
            {selectedStatus ? (
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
            )}
          </aside>
        </main>
      )}
    </div>
  )
}

export default App
