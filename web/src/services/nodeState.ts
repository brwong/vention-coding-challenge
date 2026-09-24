import { type NodeInfo, nodeUrl } from './nodeDiscovery'

export const RUNNING_POLL_INTERVAL_MS = 100
export const IDLE_POLL_INTERVAL_MS = 1000
export const STATUS_TIMEOUT_MS = 1000
// Coordination changes are slower than the swing, and the barrier lasts seconds.
export const PROTOCOL_POLL_INTERVAL_MS = 500

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

/** The fields the UI uses from a node's GET /protocol-status response. */
export interface ProtocolStatus {
  nodeId: string
  term: number
  leader: string | null
  isLeader: boolean
  lifecycle: Lifecycle
  restartBarrier: string[] // nodes this one has heard RESTART from
  awaitingRestart: boolean // stopped by a collision and still collecting RESTARTs
  quorumSize: number // RESTARTs needed before the restart countdown
}

export async function fetchProtocolStatus(port: number): Promise<ProtocolStatus> {
  const response = await fetch(nodeUrl(port, '/protocol-status'), {
    signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`GET /protocol-status on port ${port} failed with ${response.status}`)
  }
  return response.json()
}

/**
 * Fetches from every active node, hands the successes (keyed by nodeId) to
 * the callback, and repeats after `nextDelay` of those results. Returns a
 * function that stops polling.
 */
function pollActiveNodes<T extends { nodeId: string }>(
  nodes: NodeInfo[],
  fetcher: (port: number) => Promise<T>,
  callback: (results: Map<string, T>) => void,
  nextDelay: (results: Map<string, T>) => number,
): () => void {
  const active = nodes.filter((node) => node.status === 'active')
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined

  // Chain timeouts rather than use setInterval so slow polls never overlap.
  const run = async () => {
    const settled = await Promise.allSettled(active.map((node) => fetcher(node.port)))
    if (stopped) return

    const results = new Map<string, T>()
    for (const result of settled) {
      if (result.status === 'fulfilled') results.set(result.value.nodeId, result.value)
    }
    callback(results)
    timer = setTimeout(run, nextDelay(results))
  }
  run()

  return () => {
    stopped = true
    clearTimeout(timer)
  }
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
  return pollActiveNodes(nodes, fetchNodeStatus, callback, (statuses) => {
    const anyRunning = [...statuses.values()].some((status) => status.lifecycle === 'running')
    return anyRunning ? intervalMs : IDLE_POLL_INTERVAL_MS
  })
}

/** Polls /protocol-status on every active node every PROTOCOL_POLL_INTERVAL_MS. */
export function pollProtocolStates(
  nodes: NodeInfo[],
  callback: (protocols: Map<string, ProtocolStatus>) => void,
): () => void {
  return pollActiveNodes(nodes, fetchProtocolStatus, callback, () => PROTOCOL_POLL_INTERVAL_MS)
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

/** Sends one PUT /config with every field. Throws with the node's error message on rejection. */
export async function applyConfig(port: number, config: PendulumConfig): Promise<PendulumConfig> {
  const response = await fetch(nodeUrl(port, '/config'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
    signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(body?.error ?? `PUT /config on port ${port} failed with ${response.status}`)
  }
  return body
}
