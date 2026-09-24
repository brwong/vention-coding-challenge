import { type NodeInfo, nodeUrl } from './nodeDiscovery'

export const RUNNING_POLL_INTERVAL_MS = 100
export const IDLE_POLL_INTERVAL_MS = 1000
export const STATUS_TIMEOUT_MS = 1000

export type Lifecycle = 'ready' | 'running' | 'paused' | 'stopped' | 'restarting'

export interface PendulumConfig {
  x: number // hinge x-coordinate
  length: number
  mass: number
  angle: number // initial angle in degrees
}

/** The body of a node's GET /status response. */
export interface PendulumStatus {
  nodeId: string
  port: number
  state: {
    angle: number // radians, positive swings toward +x
    angularVelocity: number // rad/s
    running: boolean
    stopped: boolean
    restarting: boolean
  }
  config: PendulumConfig
  lifecycle: Lifecycle
}

export async function fetchNodeStatus(port: number): Promise<PendulumStatus> {
  const response = await fetch(nodeUrl(port, '/status'), {
    signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`GET /status on port ${port} failed with ${response.status}`)
  }
  return response.json()
}

/**
 * Polls /status on every active node. Polls every `intervalMs` while any node
 * is running and every IDLE_POLL_INTERVAL_MS otherwise. The callback gets the
 * statuses keyed by nodeId; unreachable nodes are left out. Returns a
 * function that stops polling.
 */
export function pollNodeStates(
  nodes: NodeInfo[],
  intervalMs: number,
  callback: (statuses: Map<string, PendulumStatus>) => void,
): () => void {
  const active = nodes.filter((node) => node.status === 'active')
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined

  // Chain timeouts rather than use setInterval so slow polls never overlap.
  const run = async () => {
    const results = await Promise.allSettled(active.map((node) => fetchNodeStatus(node.port)))
    if (stopped) return

    const statuses = new Map<string, PendulumStatus>()
    for (const result of results) {
      if (result.status === 'fulfilled') statuses.set(result.value.nodeId, result.value)
    }
    callback(statuses)

    const anyRunning = [...statuses.values()].some((status) => status.lifecycle === 'running')
    timer = setTimeout(run, anyRunning ? intervalMs : IDLE_POLL_INTERVAL_MS)
  }
  run()

  return () => {
    stopped = true
    clearTimeout(timer)
  }
}

export type LifecycleCommand = 'start' | 'pause' | 'stop'

export async function sendCommand(port: number, command: LifecycleCommand): Promise<void> {
  const response = await fetch(nodeUrl(port, `/${command}`), {
    method: 'POST',
    signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`POST /${command} on port ${port} failed with ${response.status}`)
  }
}
