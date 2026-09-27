import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { PendulumStatus, ProtocolStatus } from '../services/nodeState'
import { LifecycleIndicator } from './LifecycleIndicator'

function status(lifecycle: PendulumStatus['lifecycle']): PendulumStatus {
  return {
    nodeId: 'node-7700',
    port: 7700,
    state: { angle: 0, angularVelocity: 0, running: false, stopped: true, restarting: false },
    config: { x: 0, length: 100, mass: 4200, angle: 20 },
    lifecycle,
  }
}

function protocol(overrides: Partial<ProtocolStatus>): ProtocolStatus {
  return {
    nodeId: 'node-7700',
    epoch: 1,
    lifecycle: 'stopped',
    restartBarrier: [],
    awaitingRestart: true,
    quorumSize: 3,
    stoppedBy: null,
    ...overrides,
  }
}

describe('LifecycleIndicator', () => {
  it('badges the node whose report caused the current stop', () => {
    render(<LifecycleIndicator status={status('stopped')} protocol={protocol({ stoppedBy: 'node-7700' })} unreachable={false} />)
    expect(screen.getByText('collision')).toBeInTheDocument()
  })

  it('does not badge a node that merely obeyed someone else\'s STOP', () => {
    render(<LifecycleIndicator status={status('stopped')} protocol={protocol({ stoppedBy: 'node-7701' })} unreachable={false} />)
    expect(screen.queryByText('collision')).not.toBeInTheDocument()
  })

  it('drops the badge once the reporter is running again', () => {
    render(<LifecycleIndicator status={status('running')} protocol={protocol({ stoppedBy: 'node-7700', lifecycle: 'running', awaitingRestart: false })} unreachable={false} />)
    expect(screen.queryByText('collision')).not.toBeInTheDocument()
  })
})
