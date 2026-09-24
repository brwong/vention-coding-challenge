import { useEffect, useState } from 'react'
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
  RUNNING_POLL_INTERVAL_MS,
  applyConfig,
  pollNodeStates,
  sendCommand,
} from './services/nodeState'

const COMMAND_VERBS: Record<LifecycleCommand, string> = {
  start: 'Started',
  pause: 'Paused',
  stop: 'Stopped',
}

const GROUP_COMMANDS: { command: LifecycleCommand; label: string }[] = [
  { command: 'start', label: 'Start All' },
  { command: 'pause', label: 'Pause All' },
  { command: 'stop', label: 'Stop All' },
]

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
  const [scanned, setScanned] = useState(false)
  const [statuses, setStatuses] = useState(new Map<string, PendulumStatus>())
  const [lastUpdated, setLastUpdated] = useState(new Map<string, number>())
  const [selectedNodeId, setSelectedNodeId] = useState<string>()
  // Unapplied edits, shared by the form and the canvas. They belong to one node
  // and are ignored once another node is selected.
  const [draft, setDraft] = useState<{ nodeId: string; fields: ConfigDraft }>()
  const [actionMessage, setActionMessage] = useState<string>()
  const [busy, setBusy] = useState(false)
  // Bumping these restarts the scan or the polling right away.
  const [scanKey, setScanKey] = useState(0)
  const [pollKey, setPollKey] = useState(0)

  useEffect(
    () =>
      startPeriodicScan((found) => {
        setScanned(true)
        // Keep the old array when nothing changed so polling isn't restarted.
        setNodes((previous) => (sameNodes(previous, found) ? previous : found))
      }),
    [scanKey],
  )

  useEffect(
    () =>
      pollNodeStates(nodes, RUNNING_POLL_INTERVAL_MS, (polled) => {
        setStatuses(polled)
        setLastUpdated((previous) => {
          const next = new Map(previous)
          const now = Date.now()
          for (const nodeId of polled.keys()) next.set(nodeId, now)
          return next
        })
      }),
    [nodes, pollKey],
  )

  const activeNodes = nodes.filter((node) => node.status === 'active')

  async function runGroupCommand(command: LifecycleCommand) {
    setBusy(true)
    const results = await Promise.allSettled(
      activeNodes.map((node) => sendCommand(node.port, command)),
    )
    const failed = activeNodes.filter((_, i) => results[i].status === 'rejected')
    const succeeded = activeNodes.length - failed.length
    let message = `${COMMAND_VERBS[command]} ${succeeded}/${activeNodes.length} nodes`
    if (failed.length > 0) {
      message += `, ${failed.length} failed (${failed.map((node) => node.nodeId).join(', ')})`
    }
    setActionMessage(message)
    setBusy(false)
    // Poll now rather than wait out the idle interval, so the change shows at once.
    setPollKey((key) => key + 1)
  }

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
          <button type="button" onClick={() => setScanKey((key) => key + 1)}>
            Refresh Nodes
          </button>
        </div>
        {actionMessage && (
          <p className="action-message" role="status">
            {actionMessage}
          </p>
        )}
      </header>
      {nodes.length === 0 ? (
        <p className="empty">{scanned ? 'No nodes found' : 'Scanning for nodes…'}</p>
      ) : (
        <main>
          <PendulumCanvas
            nodes={nodes}
            statuses={statuses}
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
              lastUpdated={lastUpdated}
              selectedNodeId={selected}
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
