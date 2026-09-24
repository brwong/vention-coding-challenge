export const HOST = '127.0.0.1'
export const BASE_PORT = 7700
// Nodes take the first free port, so a short run of misses marks the end.
export const MAX_CONSECUTIVE_MISSES = 5
export const SCAN_INTERVAL_MS = 5000
export const PROBE_TIMEOUT_MS = 500
// A node missing from later scans stays listed as inactive for this long.
export const FORGET_AFTER_MS = 30_000

export interface NodeInfo {
  nodeId: string // e.g. "node-7701"
  port: number
  status: 'active' | 'inactive'
  x?: number
  lastSeen: number // timestamp
}

export function nodeUrl(port: number, path: string): string {
  return `http://${HOST}:${port}${path}`
}

async function probe(port: number): Promise<NodeInfo | null> {
  try {
    const response = await fetch(nodeUrl(port, '/status'), {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    if (!response.ok) return null
    const body = await response.json()
    if (typeof body?.nodeId !== 'string') return null
    return {
      nodeId: body.nodeId,
      port,
      status: 'active',
      x: typeof body.config?.x === 'number' ? body.config.x : undefined,
      lastSeen: Date.now(),
    }
  } catch {
    // Refused connections, timeouts and non-JSON replies all count as misses.
    return null
  }
}

/** Probes ports from BASE_PORT upward until MAX_CONSECUTIVE_MISSES in a row fail. */
export async function scanForNodes(): Promise<NodeInfo[]> {
  const found: NodeInfo[] = []
  let misses = 0
  for (let port = BASE_PORT; misses < MAX_CONSECUTIVE_MISSES; port++) {
    const node = await probe(port)
    if (node) {
      found.push(node)
      misses = 0
    } else {
      misses++
    }
  }
  return found
}

/**
 * Combines a fresh scan with the previous list: nodes that dropped out are
 * kept as inactive until FORGET_AFTER_MS has passed since they were last seen.
 */
export function mergeScan(previous: NodeInfo[], found: NodeInfo[], now = Date.now()): NodeInfo[] {
  const foundIds = new Set(found.map((node) => node.nodeId))
  const missing = previous
    .filter((node) => !foundIds.has(node.nodeId) && now - node.lastSeen < FORGET_AFTER_MS)
    .map((node): NodeInfo => ({ ...node, status: 'inactive' }))
  return [...found, ...missing].sort((a, b) => a.port - b.port)
}

/** Scans now and then every SCAN_INTERVAL_MS. Returns a function that stops scanning. */
export function startPeriodicScan(callback: (nodes: NodeInfo[]) => void): () => void {
  let known: NodeInfo[] = []
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined

  // Chain timeouts rather than use setInterval so slow scans never overlap.
  const run = async () => {
    const found = await scanForNodes()
    if (stopped) return
    known = mergeScan(known, found)
    callback(known)
    timer = setTimeout(run, SCAN_INTERVAL_MS)
  }
  run()

  return () => {
    stopped = true
    clearTimeout(timer)
  }
}
