---
title: Coordination Strategy for Distributed Pendulum
scope: Leaderless STOP/RESTART coordination, stop epochs, message ordering, time/clock model, membership discovery
when_to_use: When implementing the distributed coordination layer (STOP/RESTART, stop epochs, position sharing, node discovery)
audience: Coding LLM or developer implementing server-side logic
---

## Overview

This document defines the coordination strategy for the distributed pendulum simulation. It covers:

- Membership discovery (dynamic node join/leave)
- Coordination model (leaderless, epoch-numbered stops)
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

- **Leaderless.** Every node plays the same role; there is no leader, lease or election.
- The node that detects a collision broadcasts `STOP` to all instances itself, and every node that stops broadcasts its own `RESTART` and waits for `RESTART` from all the others. This follows the spec's wording directly.
- Position sharing, collision detection and membership are peer-to-peer as well.

### Stop Epochs

- Each stop is numbered by an **epoch**: a counter every node keeps, holding the newest epoch it has seen in any `STOP`, `RESTART` or `HEARTBEAT`.
- A node that detects a collision uses **its newest known epoch + 1** for the new stop.
- Heartbeats carry the sender's epoch, so a node that joined late or missed a stop catches up within one heartbeat interval and picks an epoch the others will obey.
- Both bobs in a collision usually detect it on the same tick. Both nodes then pick the same epoch, and receivers treat the second `STOP` for an epoch they already obeyed as a repeat, so the two reports merge into one stop.
- Each `STOP` names its `reporter`. When several reporters send a `STOP` for the same epoch, every node keeps the **lowest node ID**, so all nodes agree on who caused the stop.
- Node IDs are derived from the port (`node-7700`, `node-7701`, …) and ordered by port number.

### Why No Leader

- On a single host there are no network partitions, so a leader's majority lease protects against a scenario that cannot occur here, while an election leaves a window (the election timeout, about 2 seconds) in which no collision can be acted on.
- STOP reaches peers in one hop instead of two (detector → leader → all).
- Every node is identical, which keeps the code and tests small.
- Trade-off: nothing prevents a node with a stale view from stopping the others. On a multi-host network that can split, a leader (or quorum) would be worth reconsidering.

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
- If a collision is detected while the local pendulum is running:
  - Broadcast `STOP` with a new epoch to all known peers and stop locally (see below). Stopping ends collision checks until the restart, so one collision is reported once per node.

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

- `running` → `stopped` on a local collision, or on a `STOP` (or `RESTART`) for a newer epoch.
- `stopped` → `restarting` when the RESTART barrier is satisfied for the current epoch.
- `restarting` → `running` after the 5-second timer expires.

All transitions are gated by epoch: messages for an epoch older than the newest known one are ignored.

### STOP

1. A node detects a collision:
   - Picks `epoch = newest known epoch + 1`.
   - Broadcasts `STOP` with that epoch to all known peers, naming itself as `reporter`.
   - Stops locally and continues with RESTART below.
2. Every node receiving `STOP`:
   - Ignores it if its epoch is older than the newest known epoch.
   - If it has already stopped for this epoch, treats it as another report of the same stop (keeping the lowest-ID reporter).
   - Otherwise stops, adopts the epoch, and continues with RESTART below.

### RESTART

1. Every node, once it has stopped for an epoch:
   - Holds still for a short pause (500 ms), so the collision stays visible; without it the barrier would complete within milliseconds and reset the pendulums before anyone could see where they stopped.
   - Then adds itself to the RESTART barrier and broadcasts `RESTART` with that epoch to all known peers, once.
2. Every node receiving `RESTART`:
   - If the epoch is newer than its last stop, the RESTART overtook its STOP: it stops first (and later sends its own RESTART) as if the STOP had arrived.
   - Adds the sender to its barrier for that epoch.
3. When the barrier holds RESTART from **every live node** (all peers not suspected dead, plus itself), the node resets its pendulum to its initial angle, starts a 5-second local timer, and transitions to `running` when it expires.

### Failure Handling

- Add timeouts for the RESTART barrier:
  - If a node has not received enough `RESTART` messages within a configured timeout (e.g., 10s), it proceeds with the RESTARTs it has. A node that dies during a stop therefore delays the restart by at most this timeout; one already suspected dead (silent for 2s) is not waited for at all.
- Ensure messages are **idempotent**:
  - Receiving duplicate `STOP`/`RESTART` for the same epoch does not break state.

## Time and Clock Model

### Logical Time Only

- Each node maintains:
  - A local simulation tick counter (for physics).
  - A per-node `seq` counter for POSITION messages.
  - An `epoch` counter numbering collision stops, kept in step through STOP, RESTART and heartbeats.
- No synchronized wall-clock time is required or assumed.

### Ordering Guarantees

- Per-node POSITION messages are ordered by `seq`.
- Coordination messages (`STOP`, `RESTART`) are ordered by `epoch`.
- Nodes ignore messages with older `seq` or `epoch` than what they have already processed.

### No Clock Synchronization

- Do **not** implement NTP, PTP, or any clock-offset estimation.
- Do **not** compare tick values across nodes to infer "same time".
- Use only:
  - Local timers for timeouts and leases.
  - Logical counters (`seq`, `epoch`) for ordering.

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

Sent periodically by every node to every peer, for membership liveness and to share the newest known epoch.

```json
{
  "type": "HEARTBEAT",
  "nodeId": "node-7700",
  "epoch": 3
}
```

### Coordination

#### `STOP`

The node that detected a collision → all.

```json
{
  "type": "STOP",
  "epoch": 4,
  "from": "node-7702",
  "reporter": "node-7702"
}
```

#### `RESTART`

Every stopped node → all, once per epoch.

```json
{
  "type": "RESTART",
  "epoch": 4,
  "from": "node-7700"
}
```

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
- Leaderless STOP/RESTART: the detecting node broadcasts STOP, every stopped node broadcasts RESTART.
- Push-based position sharing with per-node `seq`.
- Local collision detection using latest cached positions.
- STOP/RESTART state machine with epoch-based filtering and an all-live-nodes RESTART barrier with a timeout.
- Basic timeouts for liveness (RESTART barrier, peer removal).

### Do Not Implement

- True clock synchronization.
- Cross-node tick alignment or offset estimation.
- Spatial filtering / neighbor culling.
- Pull-based position requests.
- Complex multi-phase commit protocols.
- Multi-host discovery (CLI `--peers` is documented as a future extension only).
- Leader election, leases, or any other single coordinator.

**Justification**: Keep the system simple, testable, and appropriate for a small, dynamic cluster on a single host while still demonstrating sound distributed design.