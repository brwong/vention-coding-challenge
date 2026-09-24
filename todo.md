# Vention Pendulum - Implementation Plan

This document outlines the phased implementation plan for the distributed pendulum simulation. Each section is independently runnable and manually testable.

Do not mention this document in commit messages or code (comments). Check off items as they are completed, and include this file in the commit.

**Key constraints from spec documents:**
- Base port: `7700`, auto-increment on conflict (no `--port` flag) [interfaces:1]
- CLI flags: `--x`, `--length`, `--mass`, `--angle` only [interfaces:1]
- Default values: `length=100`, `mass=4200` (bob radius ≈ 10), `angle=20°` (degrees) [interfaces:1]
- Physics: 60 Hz fixed timestep, semi-implicit Euler, full nonlinear equation [physics:1]
- Node ID format: `node-7701` (derived from port) [interfaces:1]
- UI: SVG rendering, HTTP polling only, no WebSockets [interfaces:1]
- Coordination: Leader/lease/election, term-based STOP/RESTART, quorum barrier [coordination:1]

If applicable, read the documentation in the `docs` folder - don't guess or invent the system from scratch.

---

## Section 1: Project Bootstrapping

**Goal:** Establish the basic project structure with minimal working stubs for both the node servers and web UI.

- [x] Create project root directory structure
  - [x] `/nodes` - directory for Node.js pendulum servers
  - [x] `/web` - directory for React web UI
  - [x] `/docs` - directory for documentation (interfaces.md, coordination.md, physics.md already exist)

- [x] Initialize Node.js project in `/nodes`
  - [x] Run `npm init -y` to create package.json
  - [x] Install TypeScript: `npm install --save-dev typescript @types/node`
  - [x] Install argument parser: `npm install --save minimist` and `npm install --save-dev @types/minimist`
  - [x] Create `tsconfig.json` with basic Node.js configuration
  - [x] Create `src/index.ts` with a simple "Hello from pendulum node" console.log statement
  - [x] Add npm script: `"start": "ts-node src/index.ts"` or `"build": "tsc"` + `"start": "node dist/index.js"`

- [x] Initialize React project in `/web`
  - [x] Run `npm create vite@latest . -- --template react-ts` (or equivalent)
  - [x] Install dependencies
  - [x] Modify `src/App.tsx` to display only the word "Pendulum" on screen
  - [x] Add npm scripts: `"dev": "vite"`, `"build": "tsc && vite build"`, `"preview": "vite preview"`

- [x] Create `.gitignore` files
  - [x] Root `.gitignore`: `node_modules/`, `dist/`, `.env`, `*.log`, `DS_Store`, `coverage/`
  - [x] Or separate `.gitignore` in `/nodes` and `/web` with appropriate entries

- [x] Create root `README.md`
  - [x] Project title and brief description
  - [x] Instructions to start a node server: `cd nodes && npm install && npm start [--x <number> --length <number> --mass <number> --angle <number>]`
  - [x] Note: Nodes auto-bind to first available port starting at 7700
  - [x] Instructions to start the web UI: `cd web && npm install && npm run dev`
  - [x] Nothing more at this stage

**Testable outcome:**
- Running `npm start` in `/nodes` prints "Hello from pendulum node" to console
- Running `npm run dev` in `/web` shows a browser page with "Pendulum" text
- Git can track the project without committing node_modules or build artifacts

---

## Section 2: Node Server Core Implementation

**Goal:** Implement a single pendulum node with CLI parsing, auto port binding, physics simulation, REST API, and terminal status display.

### 2.1 Project Configuration

- [x] Update `/nodes/package.json` with production dependencies
  - [x] `express` - REST API server
  - [x] `@types/express` - TypeScript types for Express
  - [x] `cors` - Enable CORS for web UI communication
  - [x] `@types/cors` - TypeScript types for CORS
  - [x] `minimist` - CLI argument parsing (already installed in Section 1)

- [x] Update `/nodes/tsconfig.json` if needed for Express types

### 2.2 Command-Line Interface & Configuration

- [x] Create `src/config.ts`
  - [x] Define configuration interface:
    ```ts
    interface Config {
      x?: number;        // hinge x-coordinate (optional, assigned from join order if omitted)
      length: number;    // pendulum length in distance units (default: 100)
      mass: number;      // bob mass (default: 4200, radius ≈ 10)
      angle: number;     // initial angle in degrees (default: 20)
      port: number;      // auto-discovered, not user-configurable
      nodeId: string;    // derived from port: `node-7701`
    }
    ```
  - [x] Implement CLI argument parsing using `minimist`
    - [x] Support flags: `--x`, `--length`, `--mass`, `--angle`
    - [x] Validate all numeric flags as finite numbers
    - [x] Validate `length > 0`, `mass > 0`
    - [x] Validate `angle` is in range `[-180, 180]` degrees (or `[-π, π]` radians)
    - [x] Provide `--help` output
  - [x] Implement port auto-discovery:
    - [x] Start at port `7700`
    - [x] Attempt to bind; if fails (EADDRINUSE), increment and retry
    - [x] Continue until successful
  - [x] Generate `nodeId` from selected port: `node-${port}`
  - [x] Export a `loadConfig()` function that returns the parsed configuration

- [x] Create `src/constants.ts`
  - [x] Define named constants:
    ```ts
    export const DEFAULT_LENGTH = 100;
    export const DEFAULT_MASS = 4200; // bob radius ≈ 10
    export const DEFAULT_ANGLE_DEG = 20;
    export const BASE_PORT = 7700;
    export const MAX_PORT_SEARCH = 100; // prevent infinite loop
    ```

- [x] Update `src/index.ts` to use the configuration
  - [x] Log the loaded configuration on startup

### 2.3 Physics Engine

- [x] Create `src/constants.ts` (or extend from above)
  - [x] Add physics constants:
    ```ts
    export const PHYSICS_HZ = 60;
    export const DT = 1 / 60;
    export const GRAVITY = 981; // distance units/s² (1 unit = 1 cm; 100-unit period ≈ 2 s)
    export const COLLISION_MARGIN = 1; // distance units
    export const MIN_MASS = 35; // bob radius ≈ 2
    export const MAX_MASS = 34000; // bob radius ≈ 20
    export const MIN_LENGTH = 10;
    export const MAX_LENGTH = 200;
    export const MIN_ANGLE_RAD = -Math.PI;
    export const MAX_ANGLE_RAD = Math.PI;
    ```

- [x] Create `src/physics.ts`
  - [x] Implement `normalizeAngle(angle: number): number`
    - [x] Normalize to `[-π, π]` range using the formula from physics.md
  - [x] Define `PendulumState` interface:
    ```ts
    interface PendulumState {
      angle: number;        // radians, normalized to [-π, π]
      angularVelocity: number; // rad/s
      angularAcceleration: number; // rad/s²
    }
    ```
  - [x] Implement `createPendulum(initialAngleDeg: number): PendulumState`
    - [x] Convert degrees to radians
    - [x] Initialize with `angularVelocity = 0`, `angularAcceleration = 0`
  - [x] Implement `updatePendulum(state: PendulumState, length: number): PendulumState`
    - [x] Use semi-implicit Euler with fixed `dt = 1/60`
    - [x] Calculate: `angularAcceleration = -(GRAVITY / length) * sin(angle)`
    - [x] Update: `angularVelocity += angularAcceleration * dt`
    - [x] Update: `angle += angularVelocity * dt`
    - [x] Normalize angle after update
  - [x] Implement `calculateBobRadius(mass: number): number`
    - [x] Use unit density (mass = volume): `r = cbrt(3 * mass / (4 * π))`
  - [x] Implement `getPosition(state: PendulumState, anchorX: number, anchorY: number, length: number): { x: number, y: number }`
    - [x] Calculate: `x = anchorX + length * sin(angle)`, `y = anchorY + length * cos(angle)`
    - [x] Note: Assumes positive Y points downward (screen coordinates)
  - [x] Implement `checkCollision(state1: PendulumState, state2: PendulumState, anchor1: {x,y}, anchor2: {x,y}, length1: number, length2: number, mass1: number, mass2: number): boolean`
    - [x] Calculate bob positions
    - [x] Calculate bob radii from mass
    - [x] Check: `distance(p1, p2) <= r1 + r2 + COLLISION_MARGIN`
  - [x] Export all functions for use in the main server

### 2.4 REST API Server

- [x] Create `src/server.ts`
  - [x] Initialize Express app with CORS enabled (allow requests from web UI origin)
  - [x] Implement `GET /status` endpoint
    - [x] Returns:
      ```json
      {
        "nodeId": "node-7701",
        "port": 7701,
        "state": {
          "angle": 0.349, // radians
          "angularVelocity": 0.12,
          "running": true,
          "stopped": false,
          "restarting": false
        },
        "config": {
          "x": 100,
          "length": 100,
          "mass": 4200,
          "angle": 20
        },
        "lifecycle": "running" | "paused" | "stopped" | "restarting"
      }
      ```
  - [x] Implement `GET /config` endpoint
    - [x] Returns current configuration: `{ x, length, mass, angle }`
  - [x] Implement `PUT /config` endpoint
    - [x] Accepts: `{ x?, length?, mass?, angle? }`
    - [x] Validate all values against constraints from physics.md
    - [x] Update configuration and reset pendulum state to new initial angle
    - [x] Returns updated configuration
  - [x] Implement `POST /start` endpoint
    - [x] Sets lifecycle state to `running`
    - [x] Starts physics simulation loop if not already running
  - [x] Implement `POST /pause` endpoint
    - [x] Sets lifecycle state to `paused`
    - [x] Stops physics updates but preserves current state
  - [x] Implement `POST /stop` endpoint
    - [x] Sets lifecycle state to `stopped`
    - [x] Stops physics updates
  - [x] Implement coordination endpoints (stubs for now, full implementation in Section 4):
    - [x] `POST /message` - accepts coordination messages (JOIN, HEARTBEAT, STOP, RESTART, POSITION, COLLISION_DETECTED, ELECTION_REQUEST, ELECTION_RESPONSE)
    - [x] `GET /protocol-status` - returns coordination state

- [x] Integrate physics engine with server
  - [x] Create a simulation loop using `setInterval` at 60 Hz
  - [x] Update pendulum state using `updatePendulum()` only when `lifecycle === 'running'`
  - [x] Store current state in memory for `/status` endpoint

### 2.5 Terminal Status Display

- [x] Add terminal output functionality
  - [x] On startup: log "Pendulum Node [nodeId] started on port [port]"
  - [x] Log configuration: "Config: x=[x], length=[length], mass=[mass], angle=[angle]°"
  - [x] Every N seconds (e.g., 5s): log current state summary
    - [x] Format: `[node-7701] angle: 23.4°, running: true, lifecycle: running`
    - [x] Overwrite the text in the terminal, so it's not a flowing stream of new values
  - [ ] Log API requests at debug level (optional, use `console.debug`)

### 2.6 Main Entry Point

- [x] Update `src/index.ts`
  - [x] Import and call `loadConfig()`
  - [x] Initialize pendulum state using `createPendulum()`
  - [x] Start Express server on discovered port
  - [x] Start physics simulation loop (60 Hz)
  - [x] Start terminal status logger
- [x] Add an example usage scenario to the README

**Testable outcome:**
- Running `npm start -- --angle=45 --length=200` starts a node server
- Node auto-binds to port 7700 (or 7701 if 7700 is taken)
- `curl http://localhost:7700/status` returns JSON with pendulum state
- `curl -X POST http://localhost:7700/start` starts the simulation
- `curl http://localhost:7700/config` returns current configuration
- `curl -X PUT http://localhost:7700/config -H 'Content-Type: application/json' -d '{"angle": 30, "mass": 35}'` updates config
- Terminal shows periodic status updates
- Pendulum angle changes over time when running (verify via `/status` endpoint)
- Angle is normalized to `[-180, 180]` range

---

## Section 3: Basic Web UI - Node Discovery & Visualization

**Goal:** Create a minimal web UI that discovers running nodes via port scanning and renders their current state using SVG.

### 3.1 Web UI Setup

- [x] Clean up `/web` Vite project
  - [x] Remove default Vite/CSS boilerplate
  - [x] Keep minimal styling
  - [x] Ensure app runs on a different port than nodes (e.g., 5173 by default with Vite)

### 3.2 Node Discovery (Port Scanning)

- [x] Create `src/services/nodeDiscovery.ts`
  - [x] Define constants:
    ```ts
    const BASE_PORT = 7700;
    const MAX_CONSECUTIVE_MISSES = 10; // from interfaces.md
    const SCAN_INTERVAL_MS = 5000;
    ```
  - [x] Define `NodeInfo` interface:
    ```ts
    interface NodeInfo {
      nodeId: string; // e.g., "node-7701"
      port: number;
      status: 'active' | 'inactive';
      x?: number;
      lastSeen: number; // timestamp
    }
    ```
  - [x] Implement `scanForNodes(): Promise<NodeInfo[]>`
    - [x] Start at port 7700, increment sequentially
    - [x] For each port, attempt `fetch(\`http://127.0.0.1:\${port}/status\`, { signal: AbortSignal.timeout(500) })`
    - [x] If successful, parse response and add to results with `nodeId`, `port`, `x`, etc.
    - [x] Stop after `MAX_CONSECUTIVE_MISSES` consecutive failures
    - [x] Handle timeouts and network errors gracefully
  - [x] Implement `startPeriodicScan(callback: (nodes: NodeInfo[]) => void): () => void`
    - [x] Run `scanForNodes()` every `SCAN_INTERVAL_MS`
    - [x] Call callback with updated node list
    - [x] Return cleanup function to stop scanning

### 3.3 State Polling

- [x] Create `src/services/nodeState.ts`
  - [x] Define `PendulumStatus` interface matching the `/status` API response
  - [x] Implement `fetchNodeStatus(port: number): Promise<PendulumStatus>`
  - [x] Implement `pollNodeStates(nodes: NodeInfo[], intervalMs: number, callback: (statuses: Map<string, PendulumStatus>) => void): () => void`
    - [x] Fetch status from all active nodes at regular intervals
    - [x] Use faster polling when simulation is running (e.g., 100ms), slower when stopped (e.g., 1000ms)
    - [x] Return cleanup function to stop polling

### 3.4 Visualization Component

- [x] Create `src/components/PendulumCanvas.tsx`
  - [x] Accept props: `{ nodes: NodeInfo[], statuses: Map<string, PendulumStatus> }`
  - [x] Use SVG for rendering (required by interfaces.md)
  - [x] Calculate viewBox to fit all pendulums:
    - [x] Find min/max x from all anchors
    - [x] Add padding for swing arc
  - [x] For each node:
    - [x] Draw the anchor point (small circle or cross at `x`, `anchorY`)
    - [x] Draw the string/rod (line from anchor to bob center)
    - [x] Draw the bob (circle at calculated x, y position)
    - [x] Use different colors per nodeId for distinction
    - [x] Color-code based on lifecycle state (running=green, paused=yellow, stopped=red)
  - [x] Scale coordinates to fit the SVG viewport appropriately

- [x] Create `src/components/NodeList.tsx`
  - [x] Display a list of discovered nodes with:
    - [x] Node ID (primary identity, e.g., "node-7701")
    - [x] Port (supporting/debug info)
    - [x] Lifecycle state (running, paused, stopped)
    - [x] Last update timestamp
  - [x] Highlight the currently selected node

- [x] Create `src/components/NodeSelector.tsx`
  - [x] Allow user to select a node from the discovered list
  - [x] Show selection state visually

- [x] Update `src/App.tsx`
  - [x] Import and use `PendulumCanvas`, `NodeList`, `NodeSelector`
  - [x] Set up React state for `nodes` and `statuses`
  - [x] Use `useEffect` to start node discovery on mount
  - [x] Use `useEffect` to poll node states and update rendering
  - [x] Display "No nodes found" if scan returns empty
  - [x] Track selected node in state

### 3.5 Basic Controls

- [x] Add control buttons to `src/App.tsx`
  - [x] "Start All" - sends POST to `/start` on all discovered nodes concurrently
  - [x] "Pause All" - sends POST to `/pause` on all discovered nodes concurrently
  - [x] "Stop All" - sends POST to `/stop` on all discovered nodes concurrently
  - [x] "Refresh Nodes" - manually trigger node rescan
  - [x] Report partial failures (e.g., "Started 4/5 nodes, 1 failed")

**Testable outcome:**
- Running 3+ node servers on different ports (e.g., 7700, 7701, 7702)
- Starting the web UI shows all discovered nodes in the list
- SVG canvas renders pendulums at their current positions
- Pendulums animate as their state updates (polling at ~100ms intervals)
- Control buttons start/pause/stop all nodes simultaneously
- Adding/removing a node updates the UI within the scan interval (~5s)
- Partial failures are reported (e.g., one node unreachable)

---

## Section 4: Inter-Node Communication & Coordination

**Goal:** Implement dynamic membership, leader election, position sharing, collision detection, and STOP/RESTART protocol.

### 4.1 Membership Discovery

- [x] Extend `src/config.ts`
  - [x] Add `joinOrder: number` - position in discovery order (0 for first node, 1 for second, etc.)
  - [x] If `--x` omitted, calculate `x` from `joinOrder * SPACING` (`SPACING = 100`)

- [x] Create `src/services/membershipService.ts`
  - [x] Define `Peer` interface:
    ```ts
    interface Peer {
      nodeId: string;
      port: number;
      lastHeartbeat: number; // timestamp
    }
    ```
  - [x] Implement `probeLowerPorts(myPort: number): Promise<Peer[]>`
    - [x] After binding, scan ports from 7700 to `myPort - 1`
    - [x] For each responding port, send `JOIN` message
    - [x] Collect peer lists from responses
  - [x] Implement `sendJoin(myPort: number, targetPort: number): Promise<Peer[]>`
    - [x] POST `/message` with:
      ```json
      { "type": "JOIN", "nodeId": "node-7702", "port": 7702 }
      ```
    - [x] Parse response:
      ```json
      { "type": "JOIN_RESPONSE", "nodeId": "node-7701", "port": 7701, "peers": [...] }
      ```
    - [x] Return merged peer list
  - [x] Implement `handleJoin(message: any, peers: Peer[]): Promise<JOIN_RESPONSE>`
    - [x] Add sender to peer list
    - [x] Return current peer list
  - [x] Implement `startHeartbeat(peers: Peer[], myNodeId: string, intervalMs: number): () => void`
    - [x] Send periodic heartbeat to all known peers
    - [x] Mark peers as dead after timeout (e.g., no heartbeat for 10s)
    - [x] Return cleanup function

### 4.2 Leader Election

- [x] Create `src/services/electionService.ts`
  - [x] Define state:
    ```ts
    interface ElectionState {
      currentTerm: number;
      leaderId: string | null;
      isLeader: boolean;
      votedFor: string | null;
    }
    ```
  - [x] Implement `startElection(myNodeId: string, peers: Peer[]): Promise<string>`
    - [x] Increment term
    - [x] Send `ELECTION_REQUEST` to all peers with higher node IDs
    - [x] Collect votes (peers vote for higher ID)
    - [x] If win majority, become leader
    - [x] Return leader nodeId
  - [x] Implement `handleElectionRequest(message: any, myNodeId: string, currentTerm: number): ELECTION_RESPONSE`
    - [x] Vote for higher nodeId in same or higher term
    - [x] Update term if message has higher term
  - [x] Implement `handleElection_response(message: any): void`
    - [x] Record vote
  - [x] Implement `sendHeartbeat(myNodeId: string, term: number, peers: Peer[]): Promise<void>`
    - [x] Broadcast `HEARTBEAT` with `isLeader: true`
  - [x] Implement `handleHeartbeat(message: any): void`
    - [x] If from leader with higher/equal term, update `leaderId` and reset election timeout
    - [x] If term is higher, update current term and step down if I was leader

### 4.3 Position Sharing

- [x] Create `src/services/positionService.ts`
  - [x] Define `PositionMessage` interface:
    ```ts
    interface PositionMessage {
      type: 'POSITION';
      pendulumId: string;
      angle: number; // radians
      seq: number; // monotonically increasing
    }
    ```
  - [x] Maintain `positionCache: Map<string, PositionMessage>` - latest known position for each peer
  - [x] Implement `broadcastPosition(myNodeId: string, angle: number, seq: number, peers: Peer[]): Promise<void>`
    - [x] Send `POSITION` message to all peers
    - [x] Increment `seq` after each broadcast
  - [x] Implement `handlePosition(message: PositionMessage): void`
    - [x] If `seq > cache[pendulumId].seq`, update cache
    - [x] Ignore out-of-order messages
  - [x] Start periodic position broadcast (e.g., every physics tick or every few ticks)

### 4.4 Collision Detection

- [x] Extend `src/physics.ts` (already implemented in Section 2.3)
  - [x] Ensure `checkCollision()` uses `COLLISION_MARGIN = 1` from constants

- [x] Create `src/services/collisionService.ts`
  - [x] Implement `checkCollisions(localState: PendulumState, localConfig: Config, positionCache: Map<string, PositionMessage>, peers: Peer[]): Promise<void>`
    - [x] For each peer in cache:
      - [x] Get their latest angle from cache
      - [x] Calculate their bob position (need their config - see note below)
      - [x] Check collision with local bob
    - [x] If collision detected, send `COLLISION_DETECTED` to current leader
  - [x] Implement `sendCollisionDetected(leaderPort: number, myNodeId: string, term: number): Promise<void>`
    - [x] POST `/message` to leader with:
      ```json
      { "type": "COLLISION_DETECTED", "nodeId": "node-7702", "term": 3 }
      ```

**Note on peer config**: For collision detection, each node needs to know other nodes' lengths and anchor positions. This can be:
- Option A: Include config in `POSITION` messages (more bandwidth)
- Option B: Include config in `JOIN_RESPONSE` and assume it doesn't change during simulation
- Approved recommendation: Use Option B for simplicity; config changes require re-join or explicit config broadcast

### 4.5 STOP/RESTART Protocol

- [x] Create `src/services/protocolService.ts`
  - [x] Define lifecycle states:
    ```ts
    type LifecycleState = 'running' | 'paused' | 'stopped' | 'restarting';
    ```
  - [x] Define coordination state:
    ```ts
    interface CoordinationState {
      currentTerm: number;
      lifecycle: LifecycleState;
      leaderId: string | null;
      restartBarrier: Set<string>; // nodeIds that sent RESTART for current term
      quorumSize: number; // e.g., 4 out of 5, or all if cluster is small
    }
    ```
  - [x] Implement `handleStop(message: any, myNodeId: string): void`
    - [x] If `message.term <= currentTerm`, ignore
    - [x] If `message.term > currentTerm`, update `currentTerm`, set `lifecycle = 'stopped'`
    - [x] Stop physics simulation
  - [x] Implement `handleRestart(message: any, myNodeId: string): void`
    - [x] If `message.term < currentTerm`, ignore
    - [x] If `message.term === currentTerm`, add `message.from` to `restartBarrier`
    - [x] If `restartBarrier.size >= quorumSize`:
      - [x] Start 5-second timer
      - [x] Set `lifecycle = 'restarting'`
      - [x] After 5s: reset pendulum to initial angle, set `lifecycle = 'running'`, clear barrier
  - [x] Implement `handleCollisionDetected(message: any, myNodeId: string, isLeader: boolean): void`
    - [x] If I'm leader and `message.term === currentTerm`:
      - [x] Increment term
      - [x] Broadcast `STOP` with new term to all peers
      - [x] After brief delay (e.g., 500ms), broadcast `RESTART` with same term
  - [x] Implement `broadcastStop(term: number, peers: Peer[]): Promise<void>`
  - [x] Implement `broadcastRestart(term: number, peers: Peer[]): Promise<void>`

- [x] Extend `src/server.ts` `/message` endpoint
  - [x] Route messages by type:
    - [x] `JOIN` → membershipService.handleJoin()
    - [x] `JOIN_RESPONSE` → membershipService (already handled in probe)
    - [x] `HEARTBEAT` → electionService.handleHeartbeat()
    - [x] `ELECTION_REQUEST` → electionService.handleElection_request()
    - [x] `ELECTION_RESPONSE` → electionService.handleElection_response()
    - [x] `POSITION` → positionService.handlePosition()
    - [x] `COLLISION_DETECTED` → protocolService.handleCollisionDetected()
    - [x] `STOP` → protocolService.handleStop()
    - [x] `RESTART` → protocolService.handleRestart()
  - [x] Return appropriate response for each message type

- [x] Extend `src/index.ts`
  - [x] Initialize all services after server starts
  - [x] Run `probeLowerPorts()` and build initial peer list
  - [x] Start `startHeartbeat()` loop
  - [x] Start `broadcastPosition()` loop (every physics tick)
  - [x] Start `checkCollisions()` loop (every physics tick)
  - [x] Start leader election if no leader detected within timeout

### 4.6 Terminal Status Updates

- [x] Extend terminal logging
  - [x] Log peer discovery: "Discovered peers: [node-7700, node-7701]"
  - [x] Log election results: "Elected leader: node-7700 (term 3)"
  - [x] Log collision events: "Collision detected with node-7702"
  - [x] Log protocol transitions: "STOP received (term 4), stopping simulation", "RESTART barrier satisfied, restarting in 5s"

### 4.7 README Update

- [x] Update the example scenario in the README so that it will cause a collision some time after starting

**Testable outcome:**
- Start 5 nodes sequentially (they auto-assign ports 7700-7704)
- Each node discovers lower-port nodes via JOIN protocol
- Leader election completes (highest nodeId wins)
- Position messages flow between all nodes
- Manually trigger collision (or wait for natural collision)
- Collision detected → COLLISION_DETECTED sent to leader
- Leader broadcasts STOP → all nodes stop
- Leader broadcasts RESTART → all nodes receive, wait for quorum, restart after 5s
- All nodes restart in sync
- Terminal logs show full protocol flow
- Web UI shows all nodes stopping and restarting together
- Removing a node (kill process) doesn't crash remaining nodes; they detect via heartbeat timeout

---

## Section 5: Enhanced Web UI - Configuration & Controls

**Goal:** Add full configuration UI, individual node controls, direct manipulation (dragging), and improved UX.

### 5.1 Configuration Form

- [x] Create `src/components/NodeConfigForm.tsx`
  - [x] Accept props: `{ nodeId: string, currentConfig: Config, onApply: (config: Partial<Config>) => Promise<void> }`
  - [x] Inputs for:
    - [x] Hinge x-position (number input)
    - [x] Length (number input, validate > 0)
    - [x] Mass (number input, validate > 0)
    - [x] Initial angle (number input or slider, validate -180 to 180)
  - [x] "Apply" button sends `PUT /config` to selected node with all values in one request
  - [x] Show loading state during apply
  - [x] Show error state if request fails

### 5.2 Direct Manipulation (Dragging)

- [x] Extend `src/components/PendulumCanvas.tsx`
  - [x] Track selected node (from parent state)
  - [x] Implement drag handlers for SVG elements:
    - [x] Drag hinge horizontally → update local draft `x` value
    - [x] Drag bob → update local draft `length` and `angle` values
  - [x] Show visual feedback during drag (e.g., highlight selected pendulum)
  - [x] Maintain local draft state separate from authoritative node state
  - [x] Only send `PUT /config` when user clicks "Apply" (not on every drag movement)

- [x] Add numeric inputs alongside canvas
  - [x] Show current values for selected node
  - [x] Allow precise input via number fields or sliders
  - [x] Sync with draft state from dragging

### 5.3 Individual Node Controls

- [x] Extend `src/components/NodeList.tsx`
  - [x] Add per-node Start/Pause/Stop buttons
  - [x] Add "Configure" button that shows `NodeConfigForm` in a modal or side panel
  - [x] Show configuration panel when node is selected

### 5.4 Lifecycle State Display

- [x] Extend `src/components/NodeList.tsx` or create `src/components/LifecycleIndicator.tsx`
  - [x] Show lifecycle state: running (green), paused (yellow), stopped (red), restarting (orange)
  - [x] Show coordination state if available: "Waiting for RESTART (3/5)", "Leader: node-7700"

### 5.5 Improved UX

- [x] Add loading states
  - [x] Show "Scanning for nodes..." during initial discovery
  - [x] Show spinner on nodes being polled
- [x] Add error states
  - [x] "Node unreachable" for failed polls
  - [x] "Partial success: 4/5 nodes started" for group actions
- [x] Add responsive design
  - [x] Canvas scales to fit different screen sizes
  - [x] Controls remain usable on smaller screens
- [x] Add keyboard accessibility
  - [x] Tab through nodes and controls
  - [x] Enter/Space to activate buttons

**Testable outcome:**
- User can select a node and see its current configuration
- User can drag hinge horizontally to change x-position (draft state updates)
- User can drag bob to change length and angle (draft state updates)
- Clicking "Apply" sends one `PUT /config` request with all changes
- Changes reflect in simulation immediately
- Individual node controls work independently
- Group controls still work for all nodes
- Visualization clearly shows node states and lifecycle
- Error states are visible when nodes are unreachable

---

## Section 6: Comprehensive Testing

**Goal:** Implement a robust test suite that validates physics correctness, API behavior, and distributed coordination scenarios. Focus on high-impact tests that catch embarrassing bugs.

**Testing philosophy:** Test the things that would be embarrassing to break in a demo. Prioritize tests that verify:
1. Physics calculations are correct
2. API endpoints behave as documented
3. Distributed protocol handles failures gracefully
4. Collision detection and STOP/RESTART work end-to-end

### 6.1 Test Infrastructure Setup

- [x] Install testing dependencies in `/nodes`
  - [x] `npm install --save-dev vitest @types/node`
  - [x] `npm install --save-dev supertest` (for API integration tests)
  - [x] Add test script to package.json: `"test": "vitest run"`

- [x] Install testing dependencies in `/web`
  - [x] `npm install --save-dev vitest @testing-library/react @testing-library/jest-dom jsdom`
  - [x] Add test script to package.json: `"test": "vitest run"`

- [x] Create `vitest.config.ts` in `/nodes`
  - [x] Configure test environment: `node`
  - [x] Set test match patterns: `**/*.test.ts`

- [x] Create `vitest.config.ts` in `/web`
  - [x] Configure test environment: `jsdom`
  - [x] Set test match patterns: `**/*.test.tsx` and `**/*.test.ts`

### 6.2 Unit Tests - Physics Engine (TIER 1 - MUST HAVE)

**File: `/nodes/src/physics.test.ts`**

These tests verify the core physics calculations. They're pure functions with no dependencies, making them trivial to test.

- [x] Test `normalizeAngle()`
  - [x] Edge case: `normalizeAngle(0) === 0`
  - [x] Edge case: `normalizeAngle(Math.PI)` is ±π (same orientation; the range is `[-π, π)`)
  - [x] Edge case: `normalizeAngle(-Math.PI) === -Math.PI`
  - [x] Edge case: `normalizeAngle(3 * Math.PI)` is ±π (wraps around)
  - [x] Edge case: `normalizeAngle(-3 * Math.PI)` is ±π (wraps around)
  - [x] Edge case: `normalizeAngle(2 * Math.PI) === 0` (full rotation)
  - [x] Edge case: `normalizeAngle(Math.PI / 2) === Math.PI / 2` (no change needed)
  - [x] Edge case: `normalizeAngle(5 * Math.PI / 2) === Math.PI / 2` (wraps to same position)

- [x] Test `updatePendulum()`
  - [x] Verify angle decreases toward vertical when starting from a positive angle (pendulum swings)
  - [x] Verify angular velocity becomes negative after swinging past vertical
  - [x] Run 10 steps from 45°, verify angle is normalized and changing
  - [x] Verify energy conservation-ish behavior (oscillates, doesn't explode)
  - [x] Verify fixed timestep: running 60 updates with dt=1/60 should match 1 second of simulation

- [x] Test `calculateBobRadius()`
  - [x] Verify formula: unit density, so mass=1 gives radius ≈ 0.62 and mass=4200 gives ≈ 10
  - [x] Verify mass=8kg gives 2x radius (volume scales with cube)
  - [x] Verify radius is always positive
  - [x] Verify radius scales with cube root of mass

- [x] Test `checkCollision()`
  - [x] Two bobs at same position → collision=true
  - [x] Two bobs far apart (> r1 + r2 + margin) → collision=false
  - [x] Two bobs touching exactly (distance = r1 + r2) → collision=true (within margin)
  - [x] Two bobs nearly touching (distance = r1 + r2 + 0.5 * margin) → collision=true
  - [x] Two bobs just outside margin (distance = r1 + r2 + 1.5 * margin) → collision=false
  - [x] Different mass bobs (different radii) at various distances

**Expected runtime:** < 500ms for all physics tests

### 6.3 Unit Tests - Configuration & CLI (TIER 1 - MUST HAVE)

**File: `/nodes/src/config.test.ts`**

- [x] Test CLI argument parsing
  - [x] `--angle 45` → config.angle === 45
  - [x] `--length 200 --mass 2000` → both values parsed correctly
  - [x] `--x 100 --angle -30` → negative angle accepted
  - [x] No flags → defaults: length=100, mass=4200, angle=20
  - [x] `--help` → returns null so the node prints usage and exits cleanly

- [x] Test validation
  - [x] `--length -10` → error/rejected (negative length)
  - [x] `--mass 0` → error/rejected (zero mass)
  - [x] `--angle 200` → error/rejected (out of range, > 180)
  - [x] `--angle abc` → error/rejected (non-numeric)
  - [x] `--length Infinity` → error/rejected (not finite)

- [x] Test port auto-discovery (mocked)
  - [x] Mock `createServer` to fail on 7700, succeed on 7701 → binds to 7701
  - [x] Mock `createServer` to fail on 7700-7705, succeed on 7706 → binds to 7706
  - [x] Verify nodeId is generated correctly: port 7703 → "node-7703"

**Expected runtime:** < 500ms for all config tests

### 6.4 Unit Tests - Coordination Protocol (TIER 1 - MUST HAVE)

**File: `/nodes/src/protocol.test.ts`**

- [ ] Test term filtering
  - [ ] Receive STOP with term=3, current term=5 → ignore, state unchanged
  - [ ] Receive STOP with term=6, current term=5 → accept, update term to 6, stop
  - [ ] Receive RESTART with term=5, current term=5 → accept, add to barrier
  - [ ] Receive RESTART with term=4, current term=5 → ignore

- [ ] Test lifecycle state machine
  - [ ] Start in 'running', receive STOP → transition to 'stopped'
  - [ ] In 'stopped', receive RESTART from 4/5 nodes → transition to 'restarting', start 5s timer
  - [ ] After 5s timer → transition to 'running', reset pendulum
  - [ ] In 'running', receive RESTART → ignore (only valid in 'stopped')
  - [ ] In 'restarting', receive STOP with higher term → transition to 'stopped', cancel timer

- [ ] Test quorum calculation
  - [ ] 5 nodes, receive 4 RESTARTs → barrier satisfied
  - [ ] 5 nodes, receive 3 RESTARTs → barrier not satisfied
  - [ ] 3 nodes (2 dead), receive 2 RESTARTs → barrier satisfied (quorum adjusts)

- [ ] Test collision detection logic
  - [ ] Two pendulums at same angle, same length, same anchor → collision detected
  - [ ] Two pendulums at different angles → no collision
  - [ ] Two pendulums with anchors far apart → no collision even at same angle

**Expected runtime:** < 500ms for all protocol tests

### 6.5 Integration Tests - REST API (TIER 1 - MUST HAVE)

**File: `/nodes/src/api.test.ts`**

Use `supertest` to make HTTP requests against the Express app.

- [ ] Test `GET /status`
  - [ ] Returns 200 with correct JSON shape
  - [ ] Contains nodeId, port, state, config, lifecycle fields
  - [ ] State contains angle (number), angularVelocity (number), running (boolean)

- [ ] Test `GET /config`
  - [ ] Returns 200 with current config
  - [ ] Contains x, length, mass, angle fields
  - [ ] Values match what was set on startup or last PUT

- [ ] Test `PUT /config`
  - [ ] Valid update: `{ length: 200 }` → returns 200, config updated
  - [ ] Valid update: `{ mass: 2, angle: 30 }` → both fields updated
  - [ ] Invalid update: `{ length: -10 }` → returns 400, config unchanged
  - [ ] Invalid update: `{ mass: 0 }` → returns 400, config unchanged
  - [ ] Invalid update: `{ angle: 200 }` → returns 400, config unchanged
  - [ ] Invalid update: `{ angle: "abc" }` → returns 400, config unchanged

- [ ] Test `POST /start`
  - [ ] Returns 200, lifecycle changes to 'running'
  - [ ] Subsequent `/status` shows running=true

- [ ] Test `POST /pause`
  - [ ] Returns 200, lifecycle changes to 'paused'
  - [ ] Subsequent `/status` shows running=false, angle preserved

- [ ] Test `POST /stop`
  - [ ] Returns 200, lifecycle changes to 'stopped'

- [ ] Test `POST /message`
  - [ ] JOIN message → returns JOIN_RESPONSE with peer list
  - [ ] HEARTBEAT message → returns 200, updates lastHeartbeat
  - [ ] STOP message with valid term → returns 200, node stops
  - [ ] RESTART message → returns 200, adds to restart barrier
  - [ ] POSITION message → returns 200, updates position cache
  - [ ] Invalid message type → returns 400

- [ ] Test simulation behavior
  - [ ] POST /start, wait 500ms, GET /status → angle has changed
  - [ ] POST /pause, wait 500ms, GET /status → angle unchanged from pause
  - [ ] PUT /config with new angle, GET /status → angle reset to new initial value

**Expected runtime:** ~2-3 seconds for all API tests

### 6.6 Multi-Node Tests - Distributed Coordination (TIER 2 - HIGH VALUE)

**File: `/nodes/src/coordination.test.ts`**

Use `child_process` to spawn actual node processes and test real distributed behavior.

**Setup pattern:**
```ts
import { spawn, ChildProcess } from 'child_process';

function startNode(args: string[] = []): Promise<{ port: number, process: ChildProcess }> {
  return new Promise((resolve) => {
    const proc = spawn('npm', ['start', ...args], { cwd: '/nodes' });
    // Wait for "Pendulum Node node-770X started on port 770X" in stdout
    // Parse port number, resolve promise
  });
}
```

- [ ] Test membership discovery
  - [ ] Start node A (binds to 7700)
  - [ ] Start node B (binds to 7701)
  - [ ] Start node C (binds to 7702)
  - [ ] Wait 2s for JOIN protocol
  - [ ] GET /protocol-status on each → all know about all others
  - [ ] Verify peer lists match expected: A knows [], B knows [A], C knows [A, B]

- [ ] Test leader election
  - [ ] Start 5 nodes sequentially
  - [ ] Wait 3s for election to complete
  - [ ] GET /protocol-status on all → same leader elected (highest nodeId)
  - [ ] Kill leader process
  - [ ] Wait 3s for new election
  - [ ] GET /protocol-status on remaining → new leader elected (next highest)

- [ ] Test collision → STOP/RESTART protocol
  - [ ] Start 3 nodes with identical config (same length, mass, anchor x)
  - [ ] POST /start on all 3
  - [ ] Wait for natural collision (or manually set same initial angle)
  - [ ] Within 500ms, all 3 nodes should be 'stopped'
  - [ ] Within 6s, all 3 nodes should be 'running' again (5s restart + buffer)
  - [ ] Verify all restarted in sync (angles within 0.1 rad of each other)

- [ ] Test node failure during simulation
  - [ ] Start 5 nodes, start simulation
  - [ ] Kill middle node (e.g., node-7702)
  - [ ] Remaining 4 nodes continue running (no cascade failure)
  - [ ] Heartbeat timeout detects dead node within 10s
  - [ ] Restart killed node
  - [ ] Node rejoins via JOIN protocol, resumes simulation

**Expected runtime:** ~10-15 seconds for all coordination tests

**Implementation tips:**
- Use `proc.kill('SIGTERM')` for graceful shutdown
- Add timeout: fail test if coordination takes > 10s
- Log stdout/stderr for debugging
- Clean up all processes in `afterEach()` hook

### 6.7 Frontend Tests (TIER 2 - MODERATE VALUE)

**File: `/web/src/App.test.tsx`**

- [ ] Test component rendering
  - [ ] App renders without crashing
  - [ ] Shows "No nodes found" when scan returns empty
  - [ ] PendulumCanvas renders SVG element

- [ ] Test node discovery (mocked)
  - [ ] Mock scanForNodes to return 3 nodes
  - [ ] Verify NodeList shows 3 items
  - [ ] Verify node IDs displayed correctly

- [ ] Test controls (mocked)
  - [ ] Mock fetch for POST /start
  - [ ] Click "Start All" → fetch called 3 times (once per node)
  - [ ] Mock fetch to fail for one node
  - [ ] Verify partial failure shown in UI

**File: `/web/src/services/nodeDiscovery.test.ts`**

- [ ] Test scanForNodes (mocked fetch)
  - [ ] Mock fetch to succeed on 7700, 7701, fail on 7702+
  - [ ] Verify scan stops after 10 consecutive misses
  - [ ] Verify returned nodes have correct shape

- [ ] Test pollNodeStates (mocked fetch)
  - [ ] Mock fetch to return different states
  - [ ] Verify callback called with updated states
  - [ ] Verify cleanup function stops polling

**Expected runtime:** ~3-5 seconds for all frontend tests

### 6.8 Test Execution & CI

- [ ] Add root-level test script
  - [ ] `"test": "cd nodes && npm test && cd ../web && npm test"`

- [ ] Add test coverage reporting (optional)
  - [ ] Configure vitest to output coverage
  - [ ] Set coverage threshold (e.g., 70% for backend, 50% for frontend)

- [ ] Document how to run tests in README
  - [ ] `npm test` - run all tests
  - [ ] `npm run test:nodes` - run backend tests only
  - [ ] `npm run test:web` - run frontend tests only
  - [ ] `npm run test:watch` - run in watch mode during development

**Testable outcome:**
- Running `npm test` executes ~30-40 tests in ~15-20 seconds total
- All tests pass with clear output
- Tests catch regressions in physics, API, and coordination logic
- Multi-node tests demonstrate distributed behavior works correctly

---

## Section 7: Final Polish & Spec Verification

**Goal:** Make the project easy to run and review, improve error handling and UI feedback, then verify that the implementation satisfies every mandatory requirement in `spec.md`.

### 7.1 Repeatable Local Startup

- [ ] Create `scripts/start-demo.sh`
  - [ ] Use `#!/usr/bin/env bash`
  - [ ] Use `set -euo pipefail`
  - [ ] Start five node processes from `/nodes`
  - [ ] Start the web UI from `/web`
  - [ ] Store child process IDs
  - [ ] Add a `trap` for `INT` and `TERM` that stops all child processes cleanly
  - [ ] Wait for child processes so the script remains active while the demo runs
  - [ ] Print the expected UI URL and a short shutdown instruction

- [ ] Keep startup assumptions simple
  - [ ] Each node independently claims the next available port beginning at `7700`
  - [ ] Do not introduce a root-level package.json solely for orchestration
  - [ ] Do not add `concurrently`, Docker, or Windows-specific startup scripts
  - [ ] Document the shell script as a convenience for local development and manual testing

**Testable outcome:**
- Running `./scripts/start-demo.sh` starts five node processes and the web UI
- Pressing `Ctrl+C` stops the child processes without leaving node servers running
- The web UI discovers the nodes through its normal port-scan behavior

### 7.2 Error Handling & Logging

- [ ] Add graceful node shutdown
  - [ ] Handle `SIGINT` and `SIGTERM`
  - [ ] Stop timers and close the HTTP server
  - [ ] Log a concise shutdown message
  - [ ] Exit successfully after cleanup

- [ ] Improve API errors
  - [ ] Return `400` for malformed or invalid configuration input
  - [ ] Include a clear, safe validation message such as `{ "error": "length must be between 0.05 and 100" }`
  - [ ] Return `404` for unknown endpoints
  - [ ] Log unexpected internal errors server-side without exposing stack traces to the UI

- [ ] Keep terminal logging useful but concise
  - [ ] Log startup, selected port, node ID, and initial configuration
  - [ ] Log peer joins, removals, leader changes, collisions, STOP, and RESTART transitions
  - [ ] Avoid per-tick or per-position-message logging by default

**Testable outcome:**
- Invalid configuration requests receive understandable `400` responses
- Stopping a node process cleans up without uncaught errors
- Terminal output is sufficient to follow membership and coordination behavior during a demo

### 7.3 UI Feedback & Accessibility

- [ ] Add lightweight loading and error feedback
  - [ ] Show an initial “Scanning for nodes…” state
  - [ ] Clearly show when no reachable nodes were discovered
  - [ ] Mark unreachable nodes separately from nodes that are reachable but stopped or paused
  - [ ] Display configuration-update failures and partial group-action failures
  - [ ] Display reported collision/restart state from nodes

- [ ] Apply minimal responsive and accessible styling
  - [ ] Keep the SVG visualization usable at typical laptop widths
  - [ ] Ensure controls remain usable on narrower viewports
  - [ ] Add labels to inputs and accessible names to buttons
  - [ ] Ensure keyboard users can select a node, edit values, apply configuration, and invoke controls
  - [ ] Do not rely solely on color to convey node lifecycle state

**Testable outcome:**
- The UI distinguishes discovery, reachability, lifecycle, configuration, and group-action errors
- Core flows are usable with keyboard navigation
- A node going down appears as unreachable rather than incorrectly as paused or stopped

### 7.4 README

- [ ] Update the root `README.md` with only practical project-level information
  - [ ] Brief project description
  - [ ] Prerequisites
  - [ ] Install instructions for `/nodes` and `/web`
  - [ ] How to run one node manually
  - [ ] How to run the web UI manually
  - [ ] How to use `./scripts/start-demo.sh` for the five-node local demo
  - [ ] How to run backend and frontend tests
  - [ ] Short pointers to `interfaces.md`, `coordination.md`, and `physics.md` for implementation and design details
  - [ ] Brief known limitations, such as single-host-only operation and latest-known-state collision detection

- [ ] Keep detailed documentation in the dedicated files
  - [ ] CLI/UI behavior and HTTP interaction: `interfaces.md`
  - [ ] Membership, leadership, ordering, liveness, and STOP/RESTART behavior: `coordination.md`
  - [ ] Motion, geometry, timing, and collision math: `physics.md`
  - [ ] Do not duplicate those documents’ detailed contracts in the README
  - [ ] Do not add architecture diagrams unless they become necessary

**Testable outcome:**
- A reviewer can install, run, stop, and test the project using the README
- A reviewer can quickly find detailed implementation decisions in the dedicated Markdown files

### 7.5 Original Spec Verification

- [ ] Verify server-side simulation requirements
  - [ ] Each Node.js process owns exactly one pendulum simulation
  - [ ] Initial angle, mass, and string length are configurable
  - [ ] Five independent node instances run successfully together
  - [ ] The design is not hard-coded to exactly five nodes

- [ ] Verify neighbor communication requirements
  - [ ] Nodes discover and track peers on the local host
  - [ ] Nodes share their positions with peers
  - [ ] Collision detection uses a defined bob-to-bob threshold
  - [ ] A detected collision is reported to the leader
  - [ ] The leader sends STOP to the active cluster
  - [ ] Nodes halt their local physics simulation after valid STOP
  - [ ] The RESTART barrier behaves according to the chosen coordination contract
  - [ ] Nodes wait five seconds after the restart barrier before resuming
  - [ ] Duplicate, stale, and out-of-order protocol messages do not break coordination
  - [ ] A stopped or failed peer does not crash the surviving nodes

- [ ] Verify web UI requirements
  - [ ] React renders every discovered pendulum
  - [ ] The UI reads current node configuration before simulation start
  - [ ] The UI supports per-node configuration of angle, mass, length, and hinge position
  - [ ] The UI exposes group Start, Pause, and Stop controls
  - [ ] The UI updates visible state through periodic HTTP polling
  - [ ] The UI reports partial failures for group actions
  - [ ] The UI remains a client/controller; it does not become an authoritative simulator or coordinator

- [ ] Verify code quality and submission requirements
  - [ ] TypeScript is used consistently in nodes and web UI
  - [ ] Automated tests cover physics, configuration validation, REST API behavior, and core coordination paths
  - [ ] The test suite includes at least one real multi-process node-failure scenario
  - [ ] Errors are handled clearly at API and UI boundaries
  - [ ] README explains install, run, test, key trade-offs, and known limitations
  - [ ] Repository excludes generated artifacts and dependencies via `.gitignore`
  - [ ] Final repository is ready to share on GitHub

**Testable outcome:**
- A final manual walkthrough and the automated suite demonstrate every mandatory `spec.md` requirement.

---

## Section 8: Bonus Goals

**Goal:** Consider optional enhancements only after all mandatory requirements, tests, and final spec verification are complete.

- [ ] Decide which bonus goals are worthwhile given remaining time
- [ ] Intuitive configuration UX
- [ ] TypeScript on frontend and backend
- [ ] Single-command local startup
- [ ] Additional REST API and node-logic tests
- [ ] Additional engineering improvements that demonstrate judgment
- [ ] Wind simulation only if its scope is explicitly reconsidered

---

## Future Enhancements (Post-MVP)

- [ ] Multi-host support with `--peers=host1,host2` CLI flag [coordination:1]
- [ ] Wind simulation (if spec is updated to allow it) [physics:1]
- [ ] WebSocket-based real-time updates instead of HTTP polling
- [ ] Persistent configuration (save/load from file)
- [ ] Recording and playback of simulations
- [ ] Multi-user collaboration (multiple browsers controlling the same simulation)
- [ ] Deployment scripts for cloud hosting (AWS, Docker, etc.)
- [ ] Revisit node CPU usage from POSITION traffic, investigate, and optimize if necessary
  - [ ] Measured with 5 nodes: ~24% of a core per node, ~4% without POSITION messages; idle nodes cost the same as running ones
  - [ ] Cost is per request, not payload size (a 1 KB padded payload made no difference); most of it is `fetch` overhead
  - [ ] `AbortSignal.timeout()` in `sendMessage` leaves a 500 ms timer per request that fires after success (~13% of busy time); clear it instead
  - [ ] Try `node:http` with a shared keep-alive agent in place of `fetch`, and re-measure
  - [ ] Skip POSITION while the angle is unchanged (helps only when not running)
  - [ ] If still too costly, consider SSE for POSITION (stays HTTP and push-based); WebSocket or UDP depart further from "JSON over HTTP" [coordination:1]
  - [ ] Avoid lowering the send rate unless needed: every 2nd tick only saved ~25% and makes cached positions staler

---

## Notes

- Each section should be completed and tested before moving to the next
- Commit after each section for clear git history
- The spec requires 5 nodes, but design should work with any N >= 2
- Prioritize simplicity over cleverness throughout
- Key constants to keep in sync:
  - `BASE_PORT = 7700` [interfaces:1]
  - `PHYSICS_HZ = 60`, `DT = 1/60` [physics:1]
  - `GRAVITY = 981` [physics:1]
  - `COLLISION_MARGIN = 1` [physics:1]
  - `SPACING = 100` (default hinge spacing)
  - `MAX_CONSECUTIVE_MISSES = 10` [interfaces:1]
  - `DEFAULT_LENGTH = 100`, `DEFAULT_MASS = 4200`, `DEFAULT_ANGLE = 20°` [interfaces:1]
