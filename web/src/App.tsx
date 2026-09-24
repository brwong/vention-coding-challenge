import { useEffect, useState } from 'react'
import { NodeList } from './components/NodeList'
import { NodeSelector } from './components/NodeSelector'
import { PendulumCanvas } from './components/PendulumCanvas'
import { type NodeInfo, startPeriodicScan } from './services/nodeDiscovery'
import { type PendulumStatus, RUNNING_POLL_INTERVAL_MS, pollNodeStates } from './services/nodeState'

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

  useEffect(
    () =>
      startPeriodicScan((found) => {
        setScanned(true)
        // Keep the old array when nothing changed so polling isn't restarted.
        setNodes((previous) => (sameNodes(previous, found) ? previous : found))
      }),
    [],
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
    [nodes],
  )

  // Default to the first node, and drop a selection whose node is gone.
  const selected = nodes.some((node) => node.nodeId === selectedNodeId)
    ? selectedNodeId
    : nodes[0]?.nodeId

  return (
    <div className="app">
      <header>
        <h1>Pendulum</h1>
      </header>
      {nodes.length === 0 ? (
        <p className="empty">{scanned ? 'No nodes found' : 'Scanning for nodes…'}</p>
      ) : (
        <main>
          <PendulumCanvas nodes={nodes} statuses={statuses} selectedNodeId={selected} />
          <aside>
            <NodeSelector nodes={nodes} selectedNodeId={selected} onSelect={setSelectedNodeId} />
            <NodeList
              nodes={nodes}
              statuses={statuses}
              lastUpdated={lastUpdated}
              selectedNodeId={selected}
            />
          </aside>
        </main>
      )}
    </div>
  )
}

export default App
