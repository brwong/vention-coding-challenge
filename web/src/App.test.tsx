import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { callsTo, mockCluster } from './test/fakeCluster'

afterEach(() => {
  vi.unstubAllGlobals()
})

function threeNodes() {
  return mockCluster([7700, 7701, 7702].map((port) => ({ port, lifecycle: 'ready' as const })))
}

/** The node IDs listed in the node table, in order. */
async function listedNodeIds(): Promise<string[]> {
  const table = await screen.findByRole('table')
  const rows = within(table).getAllByRole('row').slice(1) // skip the header
  return rows.map((row) => within(row).getAllByRole('cell')[0].textContent ?? '')
}

describe('App', () => {
  it('shows it is scanning, then that no nodes were found', async () => {
    mockCluster([])
    render(<App />)
    expect(screen.getByText('Pendulum')).toBeInTheDocument()
    expect(screen.getByText('Scanning for nodes…')).toBeInTheDocument()
    expect(await screen.findByText('No nodes found')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('lists every discovered node and draws them in an SVG', async () => {
    threeNodes()
    const { container } = render(<App />)
    expect(await listedNodeIds()).toEqual(['node-7700', 'node-7701', 'node-7702'])

    const canvas = screen.getByRole('group', { name: 'Pendulums' })
    expect(canvas.tagName.toLowerCase()).toBe('svg')
    expect(container.querySelectorAll('svg [aria-label^="Select node-"]')).toHaveLength(3)
  })

  it('shows each node lifecycle and the leader once polled', async () => {
    threeNodes()
    render(<App />)
    const table = await screen.findByRole('table')
    expect(await within(table).findAllByText('ready')).toHaveLength(3)
    expect(await screen.findByText('Leader: node-7702 (term 1)')).toBeInTheDocument()
  })

  it('sends Start All to every node and reports success', async () => {
    const { fetchMock, byPort } = threeNodes()
    render(<App />)
    await listedNodeIds()

    await userEvent.click(screen.getByRole('button', { name: 'Start All' }))
    expect(await screen.findByText('3/3 nodes started')).toBeInTheDocument()
    expect(callsTo(fetchMock, 'POST', '/start').sort()).toEqual(['7700', '7701', '7702'])
    expect([...byPort.values()].map((node) => node.lifecycle)).toEqual([
      'running',
      'running',
      'running',
    ])
  })

  it('reports a partial failure when one node rejects a group command', async () => {
    const { byPort } = threeNodes()
    byPort.get(7701)!.failing = new Set(['start'])
    render(<App />)
    await listedNodeIds()

    await userEvent.click(screen.getByRole('button', { name: 'Start All' }))
    expect(
      await screen.findByText('Partial success: 2/3 nodes started; node-7701 failed'),
    ).toBeInTheDocument()
  })

  it('sends a per-node command only to that node', async () => {
    const { fetchMock } = threeNodes()
    render(<App />)
    await listedNodeIds()

    const pause = await screen.findByRole('button', { name: 'Pause node-7701' })
    await vi.waitFor(() => expect(pause).toBeEnabled())
    await userEvent.click(pause)
    expect(await screen.findByText('node-7701 paused')).toBeInTheDocument()
    expect(callsTo(fetchMock, 'POST', '/pause')).toEqual(['7701'])
  })

  it('marks a node that stops answering as unreachable', async () => {
    const { byPort } = threeNodes()
    render(<App />)
    const table = await screen.findByRole('table')
    await within(table).findAllByText('ready')

    byPort.delete(7701)
    expect(await within(table).findByText('Node unreachable', {}, { timeout: 3000 })).toBeInTheDocument()
  })
})
