---
title: Coordination Strategy for Distributed Pendulum
scope: STOP/RESTART coordination, leader election, message ordering, time/clock model, membership discovery
when_to_use: When implementing the distributed coordination layer (leader/lease/election, STOP/RESTART, position sharing, node discovery)
audience: Coding LLM or developer implementing server-side logic
---

## Overview

This document defines the coordination strategy for the distributed pendulum simulation. It covers:

- Membership discovery (dynamic node join/leave)
- Coordination model (leader/lease/election)
- Message types, states, and flows
- Time and clock assumptions
- What to implement and what not to implement

The goal is a simple, robust design that handles basic failures and supports a dynamic number of nodes on a single host, while remaining easy to implement and test.

## Membership Discovery

### Bootstrap and Port Allocation

- All nodes agree on a **base port** (e.g., `7700`).
- On startup, a node:
  1. Probes ports sequentially: `7700`, `7701`, `7702`, … until it finds one that is not in use.
  2. Attempts to **claim** the port by starting its HTTP server on that port.
  3. If binding succeeds, it proceeds; if not, it tries the next port.

### Join Protocol

- After successfully binding to a port (e.g., `7702`), the node:
  1. Sends a `JOIN` message to all lower ports (`7700` … `7701`) that respond.
  2. Collects their membership responses.
  3. Builds its initial peer list from the union of its own probes and their responses.

- Existing nodes:
  - On receiving a `JOIN`, add the new node to their peer list.
  - Respond with their current peer list (so the newcomer learns about everyone).

### Handling Leaves and Failures

- Nodes periodically send **heartbeat** messages to their known peers.
- If a node fails to receive a heartbeat (or any message) from a peer within a timeout:
  - It marks that peer as **suspected dead**.
  - After repeated failures or a longer timeout, it removes the peer from its active peer list.
- A node that was removed (or died and restarted) can rejoin by:
  - Running the same startup probe/join flow.
  - Being re-discovered via heartbeats or explicit `JOIN` from others.

### Multi-Host Note (Not Implemented)

- Future extension: add a CLI flag (e.g., `--peers=host1,host2`) to probe base ports on other hostnames.
- For this challenge, assume **single host** (e.g., `localhost`) and do not implement multi-host discovery.

## Coordination Model

### Strategy

- Use **leader/lease/election** for STOP/RESTART decisions.
- Position sharing and collision detection remain **fully peer-to-peer** and independent of the leader.

### Roles

- **Leader**:
  - Sole authority to broadcast `STOP` and `RESTART` messages.
  - Maintains a monotonically increasing `term` counter.
  - Sends periodic heartbeats to maintain its lease and support membership liveness.
- **Followers**:
  - Detect collisions locally and notify the leader.
  - Obey `STOP`/`RESTART` commands for the current term.
  - Participate in leader election if the leader is considered dead.

### Leader Election

- Implement a minimal election mechanism:
  - Each node has a stable ID (e.g., derived from port: `node-0` for 7700, `node-1` for 7701, etc.).
  - If a follower does not receive a heartbeat from the leader within a timeout, it starts an election.
  - Elections use a `term` number; higher term wins.
  - Among nodes in the same term, **higher node ID wins** (simple deterministic tie-breaker).
- Only one leader per term (avoid split-brain via term comparison).

## Position Sharing and Collision Detection

### Position Messages

- **Push-based**: Each node periodically broadcasts its position to all known peers.
- Message shape:

  ```json
  {
    "type": "POSITION",
    "pendulumId": "node-2",
    "angle": 0.42,
    "seq": 123
  }
  ```

- `pendulumId`: stable node identifier (e.g., `"node-2"`).
- `seq`: per-node, monotonically increasing sequence number.

### Collision Detection

- Each node:
  - Maintains a cache of the **latest known position** for each peer (by `seq`).
  - On each local tick, checks for collisions between:
    - Its current position, and
    - The latest cached positions of its neighbors (as defined by configuration or topology).
- If a collision is detected:
  - Send a `COLLISION_DETECTED` message to the current leader (do not broadcast STOP directly).

### What NOT to Implement

- Do **not** try to synchronize clocks or align tick counters across nodes.
- Do **not** infer fixed offsets between nodes' tick counters.
- Do **not** use other nodes' tick values in collision logic.
- Do **not** implement spatial filtering / interest management (e.g., "too far to collide").
- Do **not** implement pull-based position requests.
- Do **not** implement multi-host discovery (CLI `--peers` is a future extension only).

**Justification**: With small N and frequent position pushes, these optimizations add complexity without meaningful benefit. Collision detection uses a "latest known state" approximation, which is sufficient and robust.

## STOP / RESTART Flow

### States

Each node maintains a local state machine:

- `running`: Normal simulation; pendulum is moving.
- `stopping`: Transition state after deciding to stop (optional; can go directly to `stopped`).
- `stopped`: Pendulum halted; waiting for RESTART.
- `restarting`: RESTART barrier satisfied; running 5-second timer before resuming.

Transitions:

- `running` → `stopping` → `stopped` on valid `STOP` (higher `term`).
- `stopped` → `restarting` when RESTART barrier is satisfied for current `term`.
- `restarting` → `running` after 5-second timer expires.

All transitions are gated by `term`: ignore messages with `term` ≤ current known term.

### STOP

1. Follower detects collision → sends `COLLISION_DETECTED` to leader.
2. Leader (if still holding lease):
   - Increments `term`.
   - Broadcasts `STOP` with new `term` to all known peers.
3. All nodes:
   - Ignore `STOP` with `term` ≤ current known term.
   - On higher `term`, transition to `stopped` (optionally via `stopping`).

### RESTART

1. After stopping, leader:
   - Broadcasts `RESTART` with current `term`.
2. Each node:
   - Waits until it has received `RESTART` from a **quorum** of nodes (e.g., 4 out of current cluster size, or all if cluster is small and healthy) for the current `term`.
   - Then starts a 5-second local timer.
   - After timer expires, transitions to `running`.

### Failure Handling

- Add timeouts for the RESTART barrier:
  - If a node has not received enough `RESTART` messages within a configured timeout (e.g., 10s), it proceeds with the quorum it has.
- Ensure messages are **idempotent**:
  - Receiving duplicate `STOP`/`RESTART` for the same term does not break state.

## Time and Clock Model

### Logical Time Only

- Each node maintains:
  - A local simulation tick counter (for physics).
  - A per-node `seq` counter for POSITION messages.
  - A shared `term` counter for coordination messages (leader-driven).
- No synchronized wall-clock time is required or assumed.

### Ordering Guarantees

- Per-node POSITION messages are ordered by `seq`.
- Coordination messages (`STOP`, `RESTART`, heartbeats, election, JOIN) are ordered by `term` (and optionally a per-term sequence).
- Nodes ignore messages with older `seq` or `term` than what they have already processed.

### No Clock Synchronization

- Do **not** implement NTP, PTP, or any clock-offset estimation.
- Do **not** compare tick values across nodes to infer "same time".
- Use only:
  - Local timers for timeouts and leases.
  - Logical counters (`seq`, `term`) for ordering.

**Justification**: The system's correctness depends on event ordering, not absolute time. Logical clocks and timeouts are sufficient and simpler.

## Message Types and Shapes

All messages are JSON over HTTP (POST unless noted).

### Membership

#### `JOIN`

Sent by a new node to existing nodes.

```json
{
  "type": "JOIN",
  "nodeId": "node-2",
  "port": 7702
}
```

Response (from existing node):

```json
{
  "type": "JOIN_RESPONSE",
  "nodeId": "node-1",
  "port": 7701,
  "peers": [
    { "nodeId": "node-0", "port": 7700 },
    { "nodeId": "node-1", "port": 7701 }
  ]
}
```

### Heartbeat / Liveness

#### `HEARTBEAT`

Sent periodically by the leader (and optionally by all nodes for membership liveness).

```json
{
  "type": "HEARTBEAT",
  "nodeId": "node-0",
  "term": 3,
  "isLeader": true
}
```

### Coordination

#### `COLLISION_DETECTED`

Follower → leader.

```json
{
  "type": "COLLISION_DETECTED",
  "nodeId": "node-2",
  "term": 3
}
```

#### `STOP`

Leader → all.

```json
{
  "type": "STOP",
  "term": 4,
  "from": "node-0"
}
```

#### `RESTART`

Leader → all.

```json
{
  "type": "RESTART",
  "term": 4,
  "from": "node-0"
}
```

### Election

#### `ELECTION_REQUEST`

Sent by a node starting an election.

```json
{
  "type": "ELECTION_REQUEST",
  "nodeId": "node-2",
  "term": 4
}
```

Response (from peers):

```json
{
  "type": "ELECTION_RESPONSE",
  "nodeId": "node-1",
  "term": 4,
  "voteFor": "node-2"
}
```

(Or a simpler variant where responses just acknowledge and the requester decides based on highest ID.)

### Position

#### `POSITION`

Pushed periodically to all peers.

```json
{
  "type": "POSITION",
  "pendulumId": "node-2",
  "angle": 0.42,
  "seq": 123
}
```

## Implementation Boundaries

### Implement

- Dynamic membership via port probing + JOIN protocol (single host).
- Leader/lease/election mechanism for STOP/RESTART.
- Push-based position sharing with per-node `seq`.
- Local collision detection using latest cached positions.
- STOP/RESTART state machine with term-based filtering and quorum/timer for RESTART barrier.
- Basic timeouts for liveness (leader failure, RESTART barrier, peer removal).

### Do Not Implement

- True clock synchronization.
- Cross-node tick alignment or offset estimation.
- Spatial filtering / neighbor culling.
- Pull-based position requests.
- Complex multi-phase commit protocols.
- Multi-host discovery (CLI `--peers` is documented as a future extension only).

**Justification**: Keep the system simple, testable, and appropriate for a small, dynamic cluster on a single host while still demonstrating sound distributed design.