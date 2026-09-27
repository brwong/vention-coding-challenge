import { vi } from 'vitest'
import type { Lifecycle, PendulumStatus, ProtocolStatus } from '../services/nodeState'

export interface FakeNode {
  port: number
  lifecycle: Lifecycle
  // Commands such as 'start' that answer with an HTTP 500.
  failing?: Set<string>
  windEnabled?: boolean
}

export function statusFor(node: FakeNode): PendulumStatus {
  return {
    nodeId: `node-${node.port}`,
    port: node.port,
    state: {
      angle: 0.3,
      angularVelocity: 0,
      running: node.lifecycle === 'running',
      stopped: node.lifecycle === 'stopped',
      restarting: node.lifecycle === 'restarting',
    },
    config: { x: (node.port - 7700) * 100, length: 100, mass: 4200, angle: 20 },
    lifecycle: node.lifecycle,
  }
}

function protocolFor(node: FakeNode): ProtocolStatus {
  return {
    nodeId: `node-${node.port}`,
    epoch: 0,
    lifecycle: node.lifecycle,
    restartBarrier: [],
    awaitingRestart: false,
    quorumSize: 1,
    stoppedBy: null,
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/**
 * Replaces fetch with nodes that answer on the given ports; every other port
 * refuses the connection. Returns the fetch mock and the nodes by port.
 */
export function mockCluster(nodes: FakeNode[]) {
  const byPort = new Map(nodes.map((node) => [node.port, node]))
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const node = byPort.get(Number(url.port))
    if (!node) throw new TypeError('fetch failed')
    const method = init?.method ?? 'GET'
    const route = url.pathname

    if (method === 'GET' && route === '/status') return json(statusFor(node))
    if (method === 'GET' && route === '/protocol-status') return json(protocolFor(node))
    if (method === 'POST') {
      const command = route.slice(1)
      if (node.failing?.has(command)) return json({ error: 'Internal server error' }, 500)
      node.lifecycle = (
        { start: 'running', pause: 'paused', stop: 'stopped', reset: 'ready' } as const
      )[command as 'start' | 'pause' | 'stop' | 'reset']
      return json({ lifecycle: node.lifecycle })
    }
    if (method === 'PUT' && route === '/wind') {
      if (node.failing?.has('wind')) return json({ error: 'Internal server error' }, 500)
      node.windEnabled = true
      return json(JSON.parse(String(init?.body)))
    }
    if (method === 'DELETE' && route === '/wind') {
      if (node.failing?.has('wind')) return json({ error: 'Internal server error' }, 500)
      node.windEnabled = false
      return json({ enabled: false })
    }
    return json({ error: 'Not found' }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, byPort }
}

/** The fetch calls made with `method` to `route`, as "port" strings. */
export function callsTo(fetchMock: ReturnType<typeof mockCluster>['fetchMock'], method: string, route: string) {
  return fetchMock.mock.calls
    .filter(([input, init]) => (init?.method ?? 'GET') === method && new URL(String(input)).pathname === route)
    .map(([input]) => new URL(String(input)).port)
}
