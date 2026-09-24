import { afterEach, describe, expect, it, vi } from 'vitest'
import { callsTo, mockCluster } from '../test/fakeCluster'
import {
  BASE_PORT,
  FORGET_AFTER_MS,
  MAX_CONSECUTIVE_MISSES,
  type NodeInfo,
  mergeScan,
  scanForNodes,
} from './nodeDiscovery'
import { IDLE_POLL_INTERVAL_MS, type PendulumStatus, pollNodeStates } from './nodeState'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const range = (from: number, count: number) => Array.from({ length: count }, (_, i) => `${from + i}`)

describe('scanForNodes', () => {
  it('finds consecutive nodes and stops after MAX_CONSECUTIVE_MISSES misses', async () => {
    expect(MAX_CONSECUTIVE_MISSES).toBeLessThan(10)
    const { fetchMock } = mockCluster([
      { port: 7700, lifecycle: 'ready' },
      { port: 7701, lifecycle: 'running' },
    ])
    const nodes = await scanForNodes()

    expect(nodes.map((node) => node.nodeId)).toEqual(['node-7700', 'node-7701'])
    expect(callsTo(fetchMock, 'GET', '/status')).toEqual(range(BASE_PORT, 2 + MAX_CONSECUTIVE_MISSES))
  })

  it('returns nodes with the documented shape', async () => {
    mockCluster([{ port: 7700, lifecycle: 'ready' }])
    const [node] = await scanForNodes()
    expect(node).toEqual({
      nodeId: 'node-7700',
      port: 7700,
      status: 'active',
      x: 0,
      lastSeen: expect.any(Number),
    })
  })

  it('looks past a gap shorter than the miss limit', async () => {
    const gapEnd = 7700 + MAX_CONSECUTIVE_MISSES
    mockCluster([
      { port: 7700, lifecycle: 'ready' },
      { port: gapEnd, lifecycle: 'ready' },
    ])
    const nodes = await scanForNodes()
    expect(nodes.map((node) => node.port)).toEqual([7700, gapEnd])
  })

  it('finds nothing when no node answers', async () => {
    const { fetchMock } = mockCluster([])
    expect(await scanForNodes()).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(MAX_CONSECUTIVE_MISSES)
  })

  it('counts error responses and non-node replies as misses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const port = Number(new URL(String(input)).port)
        if (port === 7700) return new Response('{}', { status: 500 })
        if (port === 7701) return new Response('<html>')
        return new Response(JSON.stringify({ hello: 'world' }))
      }),
    )
    expect(await scanForNodes()).toEqual([])
  })
})

describe('mergeScan', () => {
  const node = (port: number, lastSeen: number): NodeInfo => ({
    nodeId: `node-${port}`,
    port,
    status: 'active',
    lastSeen,
  })

  it('keeps a node that dropped out as inactive for a while, then forgets it', () => {
    const previous = [node(7700, 0), node(7701, 0)]
    const found = [node(7700, 1000)]

    expect(mergeScan(previous, found, 1000)).toEqual([
      node(7700, 1000),
      { ...node(7701, 0), status: 'inactive' },
    ])
    expect(mergeScan(previous, found, FORGET_AFTER_MS)).toEqual([node(7700, 1000)])
  })

  it('sorts by port and marks a returning node active again', () => {
    const previous = [{ ...node(7701, 0), status: 'inactive' as const }]
    const found = [node(7702, 5), node(7701, 5)]
    expect(mergeScan(previous, found, 5)).toEqual([node(7701, 5), node(7702, 5)])
  })
})

describe('pollNodeStates', () => {
  const active = (port: number): NodeInfo => ({
    nodeId: `node-${port}`,
    port,
    status: 'active',
    lastSeen: 0,
  })

  it('hands the callback each reachable status and the unreachable node IDs', async () => {
    const { byPort } = mockCluster([
      { port: 7700, lifecycle: 'running' },
      { port: 7701, lifecycle: 'paused' },
    ])
    const callback = vi.fn()
    const stop = pollNodeStates([active(7700), active(7701), active(7702)], 50, callback)

    await vi.waitFor(() => expect(callback).toHaveBeenCalled())
    const [statuses, unreachable] = callback.mock.calls[0] as [Map<string, PendulumStatus>, Set<string>]
    expect([...statuses.keys()]).toEqual(['node-7700', 'node-7701'])
    expect(statuses.get('node-7701')?.lifecycle).toBe('paused')
    expect(unreachable).toEqual(new Set(['node-7702']))

    // Later polls pick up changes.
    byPort.get(7701)!.lifecycle = 'stopped'
    await vi.waitFor(() => {
      const [latest] = callback.mock.lastCall as [Map<string, PendulumStatus>]
      expect(latest.get('node-7701')?.lifecycle).toBe('stopped')
    })
    stop()
  })

  it('skips inactive nodes', async () => {
    const { fetchMock } = mockCluster([{ port: 7700, lifecycle: 'ready' }])
    const callback = vi.fn()
    const stop = pollNodeStates([active(7700), { ...active(7701), status: 'inactive' }], 50, callback)
    await vi.waitFor(() => expect(callback).toHaveBeenCalled())
    stop()
    expect(callsTo(fetchMock, 'GET', '/status')).toEqual(['7700'])
  })

  it('polls quickly while a node runs, slowly when idle, and not at all once stopped', async () => {
    vi.useFakeTimers()
    const { byPort, fetchMock } = mockCluster([{ port: 7700, lifecycle: 'running' }])
    const callback = vi.fn()
    const stop = pollNodeStates([active(7700)], 100, callback)

    await vi.advanceTimersByTimeAsync(0)
    expect(callback).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(100)
    expect(callback).toHaveBeenCalledTimes(2)

    byPort.get(7700)!.lifecycle = 'paused'
    await vi.advanceTimersByTimeAsync(100) // this poll sees the pause
    expect(callback).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(IDLE_POLL_INTERVAL_MS - 1)
    expect(callback).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(1)
    expect(callback).toHaveBeenCalledTimes(4)

    stop()
    const calls = fetchMock.mock.calls.length
    await vi.advanceTimersByTimeAsync(10 * IDLE_POLL_INTERVAL_MS)
    expect(fetchMock.mock.calls.length).toBe(calls)
    expect(callback).toHaveBeenCalledTimes(4)
  })
})
