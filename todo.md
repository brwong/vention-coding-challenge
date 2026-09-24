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

- [ ] Add terminal output functionality
  - [ ] On startup: log "Pendulum Node [nodeId] started on port [port]"
  - [ ] Log configuration: "Config: x=[x], length=[length], mass=[mass], angle=[angle]°"
  - [ ] Every N seconds (e.g., 5s): log current state summary
    - [ ] Format: `[node-7701] angle: 23.4°, running: true, lifecycle: running`
    - [ ] Overwrite the text in the terminal, so it's not a flowing stream of new values
  - [ ] Log API requests at debug level (optional, use `console.debug`)

### 2.6 Main Entry Point

- [ ] Update `src/index.ts`
  - [ ] Import and call `loadConfig()`
  - [ ] Initialize pendulum state using `createPendulum()`
  - [ ] Start Express server on discovered port
  - [ ] Start physics simulation loop (60 Hz)
  - [ ] Start terminal status logger
- [ ] Add an example usage scenario to the README

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

- [ ] Clean up `/web` Vite project
  - [ ] Remove default Vite/CSS boilerplate
  - [ ] Keep minimal styling
  - [ ] Ensure app runs on a different port than nodes (e.g., 5173 by default with Vite)

### 3.2 Node Discovery (Port Scanning)

- [ ] Create `src/services/nodeDiscovery.ts`
  - [ ] Define constants:
    ```ts
    const BASE_PORT = 7700;
    const MAX_CONSECUTIVE_MISSES = 10; // from interfaces.md
    const SCAN_INTERVAL_MS = 5000;
    ```
  - [ ] Define `NodeInfo` interface:
    ```ts
    interface NodeInfo {
      nodeId: string; // e.g., "node-7701"
      port: number;
      status: 'active' | 'inactive';
      x?: number;
      lastSeen: number; // timestamp
    }
    ```
  - [ ] Implement `scanForNodes(): Promise<NodeInfo[]>`
    - [ ] Start at port 7700, increment sequentially
    - [ ] For each port, attempt `fetch(\`http://127.0.0.1:\${port}/status\`, { signal: AbortSignal.timeout(500) })`
    - [ ] If successful, parse response and add to results with `nodeId`, `port`, `x`, etc.
    - [ ] Stop after `MAX_CONSECUTIVE_MISSES` consecutive failures
    - [ ] Handle timeouts and network errors gracefully
  - [ ] Implement `startPeriodicScan(callback: (nodes: NodeInfo[]) => void): () => void`
    - [ ] Run `scanForNodes()` every `SCAN_INTERVAL_MS`
    - [ ] Call callback with updated node list
    - [ ] Return cleanup function to stop scanning

### 3.3 State Polling

- [ ] Create `src/services/nodeState.ts`
  - [ ] Define `PendulumStatus` interface matching the `/status` API response
  - [ ] Implement `fetchNodeStatus(port: number): Promise<PendulumStatus>`
  - [ ] Implement `pollNodeStates(nodes: NodeInfo[], intervalMs: number, callback: (statuses: Map<string, PendulumStatus>) => void): () => void`
    - [ ] Fetch status from all active nodes at regular intervals
    - [ ] Use faster polling when simulation is running (e.g., 100ms), slower when stopped (e.g., 1000ms)
    - [ ] Return cleanup function to stop polling

### 3.4 Visualization Component

- [ ] Create `src/components/PendulumCanvas.tsx`
  - [ ] Accept props: `{ nodes: NodeInfo[], statuses: Map<string, PendulumStatus> }`
  - [ ] Use SVG for rendering (required by interfaces.md)
  - [ ] Calculate viewBox to fit all pendulums:
    - [ ] Find min/max x from all anchors
    - [ ] Add padding for swing arc
  - [ ] For each node:
    - [ ] Draw the anchor point (small circle or cross at `x`, `anchorY`)
    - [ ] Draw the string/rod (line from anchor to bob center)
    - [ ] Draw the bob (circle at calculated x, y position)
    - [ ] Use different colors per nodeId for distinction
    - [ ] Color-code based on lifecycle state (running=green, paused=yellow, stopped=red)
  - [ ] Scale coordinates to fit the SVG viewport appropriately

- [ ] Create `src/components/NodeList.tsx`
  - [ ] Display a list of discovered nodes with:
    - [ ] Node ID (primary identity, e.g., "node-7701")
    - [ ] Port (supporting/debug info)
    - [ ] Lifecycle state (running, paused, stopped)
    - [ ] Last update timestamp
  - [ ] Highlight the currently selected node

- [ ] Create `src/components/NodeSelector.tsx`
  - [ ] Allow user to select a node from the discovered list
  - [ ] Show selection state visually

- [ ] Update `src/App.tsx`
  - [ ] Import and use `PendulumCanvas`, `NodeList`, `NodeSelector`
  - [ ] Set up React state for `nodes` and `statuses`
  - [ ] Use `useEffect` to start node discovery on mount
  - [ ] Use `useEffect` to poll node states and update rendering
  - [ ] Display "No nodes found" if scan returns empty
  - [ ] Track selected node in state

### 3.5 Basic Controls

- [ ] Add control buttons to `src/App.tsx`
  - [ ] "Start All" - sends POST to `/start` on all discovered nodes concurrently
  - [ ] "Pause All" - sends POST to `/pause` on all discovered nodes concurrently
  - [ ] "Stop All" - sends POST to `/stop` on all discovered nodes concurrently
  - [ ] "Refresh Nodes" - manually trigger node rescan
  - [ ] Report partial failures (e.g., "Started 4/5 nodes, 1 failed")

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

- [ ] Extend `src/config.ts`
  - [ ] Add `joinOrder: number` - position in discovery order (0 for first node, 1 for second, etc.)
  - [ ] If `--x` omitted, calculate `x` from `joinOrder * SPACING` (`SPACING = 100`)

- [ ] Create `src/services/membershipService.ts`
  - [ ] Define `Peer` interface:
    ```ts
    interface Peer {
      nodeId: string;
      port: number;
      lastHeartbeat: number; // timestamp
    }
    ```
  - [ ] Implement `probeLowerPorts(myPort: number): Promise<Peer[]>`
    - [ ] After binding, scan ports from 7700 to `myPort - 1`
    - [ ] For each responding port, send `JOIN` message
    - [ ] Collect peer lists from responses
  - [ ] Implement `sendJoin(myPort: number, targetPort: number): Promise<Peer[]>`
    - [ ] POST `/message` with:
      ```json
      { "type": "JOIN", "nodeId": "node-7702", "port": 7702 }
      ```
    - [ ] Parse response:
      ```json
      { "type": "JOIN_RESPONSE", "nodeId": "node-7701", "port": 7701, "peers": [...] }
      ```
    - [ ] Return merged peer list
  - [ ] Implement `handleJoin(message: any, peers: Peer[]): Promise<JOIN_RESPONSE>`
    - [ ] Add sender to peer list
    - [ ] Return current peer list
  - [ ] Implement `startHeartbeat(peers: Peer[], myNodeId: string, intervalMs: number): () => void`
    - [ ] Send periodic heartbeat to all known peers
    - [ ] Mark peers as dead after timeout (e.g., no heartbeat for 10s)
    - [ ] Return cleanup function

### 4.2 Leader Election

- [ ] Create `src/services/electionService.ts`
  - [ ] Define state:
    ```ts
    interface ElectionState {
      currentTerm: number;
      leaderId: string | null;
      isLeader: boolean;
      votedFor: string | null;
    }
    ```
  - [ ] Implement `startElection(myNodeId: string, peers: Peer[]): Promise<string>`
    - [ ] Increment term
    - [ ] Send `ELECTION_REQUEST` to all peers with higher node IDs
    - [ ] Collect votes (peers vote for higher ID)
    - [ ] If win majority, become leader
    - [ ] Return leader nodeId
  - [ ] Implement `handleElectionRequest(message: any, myNodeId: string, currentTerm: number): ELECTION_RESPONSE`
    - [ ] Vote for higher nodeId in same or higher term
    - [ ] Update term if message has higher term
  - [ ] Implement `handleElection_response(message: any): void`
    - [ ] Record vote
  - [ ] Implement `sendHeartbeat(myNodeId: string, term: number, peers: Peer[]): Promise<void>`
    - [ ] Broadcast `HEARTBEAT` with `isLeader: true`
  - [ ] Implement `handleHeartbeat(message: any): void`
    - [ ] If from leader with higher/equal term, update `leaderId` and reset election timeout
    - [ ] If term is higher, update current term and step down if I was leader

### 4.3 Position Sharing

- [ ] Create `src/services/positionService.ts`
  - [ ] Define `PositionMessage` interface:
    ```ts
    interface PositionMessage {
      type: 'POSITION';
      pendulumId: string;
      angle: number; // radians
      seq: number; // monotonically increasing
    }
    ```
  - [ ] Maintain `positionCache: Map<string, PositionMessage>` - latest known position for each peer
  - [ ] Implement `broadcastPosition(myNodeId: string, angle: number, seq: number, peers: Peer[]): Promise<void>`
    - [ ] Send `POSITION` message to all peers
    - [ ] Increment `seq` after each broadcast
  - [ ] Implement `handlePosition(message: PositionMessage): void`
    - [ ] If `seq > cache[pendulumId].seq`, update cache
    - [ ] Ignore out-of-order messages
  - [ ] Start periodic position broadcast (e.g., every physics tick or every few ticks)

### 4.4 Collision Detection

- [ ] Extend `src/physics.ts` (already implemented in Section 2.3)
  - [ ] Ensure `checkCollision()` uses `COLLISION_MARGIN = 1` from constants

- [ ] Create `src/services/collisionService.ts`
  - [ ] Implement `checkCollisions(localState: PendulumState, localConfig: Config, positionCache: Map<string, PositionMessage>, peers: Peer[]): Promise<void>`
    - [ ] For each peer in cache:
      - [ ] Get their latest angle from cache
      - [ ] Calculate their bob position (need their config - see note below)
      - [ ] Check collision with local bob
    - [ ] If collision detected, send `COLLISION_DETECTED` to current leader
  - [ ] Implement `sendCollisionDetected(leaderPort: number, myNodeId: string, term: number): Promise<void>`
    - [ ] POST `/message` to leader with:
      ```json
      { "type": "COLLISION_DETECTED", "nodeId": "node-7702", "term": 3 }
      ```

**Note on peer config**: For collision detection, each node needs to know other nodes' lengths and anchor positions. This can be:
- Option A: Include config in `POSITION` messages (more bandwidth)
- Option B: Include config in `JOIN_RESPONSE` and assume it doesn't change during simulation
- Recommendation: Use Option B for simplicity; config changes require re-join or explicit config broadcast

### 4.5 STOP/RESTART Protocol

- [ ] Create `src/services/protocolService.ts`
  - [ ] Define lifecycle states:
    ```ts
    type LifecycleState = 'running' | 'paused' | 'stopped' | 'restarting';
    ```
  - [ ] Define coordination state:
    ```ts
    interface CoordinationState {
      currentTerm: number;
      lifecycle: LifecycleState;
      leaderId: string | null;
      restartBarrier: Set<string>; // nodeIds that sent RESTART for current term
      quorumSize: number; // e.g., 4 out of 5, or all if cluster is small
    }
    ```
  - [ ] Implement `handleStop(message: any, myNodeId: string): void`
    - [ ] If `message.term <= currentTerm`, ignore
    - [ ] If `message.term > currentTerm`, update `currentTerm`, set `lifecycle = 'stopped'`
    - [ ] Stop physics simulation
  - [ ] Implement `handleRestart(message: any, myNodeId: string): void`
    - [ ] If `message.term < currentTerm`, ignore
    - [ ] If `message.term === currentTerm`, add `message.from` to `restartBarrier`
    - [ ] If `restartBarrier.size >= quorumSize`:
      - [ ] Start 5-second timer
      - [ ] Set `lifecycle = 'restarting'`
      - [ ] After 5s: reset pendulum to initial angle, set `lifecycle = 'running'`, clear barrier
  - [ ] Implement `handleCollisionDetected(message: any, myNodeId: string, isLeader: boolean): void`
    - [ ] If I'm leader and `message.term === currentTerm`:
      - [ ] Increment term
      - [ ] Broadcast `STOP` with new term to all peers
      - [ ] After brief delay (e.g., 500ms), broadcast `RESTART` with same term
  - [ ] Implement `broadcastStop(term: number, peers: Peer[]): Promise<void>`
  - [ ] Implement `broadcastRestart(term: number, peers: Peer[]): Promise<void>`

- [ ] Extend `src/server.ts` `/message` endpoint
  - [ ] Route messages by type:
    - [ ] `JOIN` → membershipService.handleJoin()
    - [ ] `JOIN_RESPONSE` → membershipService (already handled in probe)
    - [ ] `HEARTBEAT` → electionService.handleHeartbeat()
    - [ ] `ELECTION_REQUEST` → electionService.handleElection_request()
    - [ ] `ELECTION_RESPONSE` → electionService.handleElection_response()
    - [ ] `POSITION` → positionService.handlePosition()
    - [ ] `COLLISION_DETECTED` → protocolService.handleCollisionDetected()
    - [ ] `STOP` → protocolService.handleStop()
    - [ ] `RESTART` → protocolService.handleRestart()
  - [ ] Return appropriate response for each message type

- [ ] Extend `src/index.ts`
  - [ ] Initialize all services after server starts
  - [ ] Run `probeLowerPorts()` and build initial peer list
  - [ ] Start `startHeartbeat()` loop
  - [ ] Start `broadcastPosition()` loop (every physics tick)
  - [ ] Start `checkCollisions()` loop (every physics tick)
  - [ ] Start leader election if no leader detected within timeout

### 4.6 Terminal Status Updates

- [ ] Extend terminal logging
  - [ ] Log peer discovery: "Discovered peers: [node-7700, node-7701]"
  - [ ] Log election results: "Elected leader: node-7700 (term 3)"
  - [ ] Log collision events: "Collision detected with node-7702"
  - [ ] Log protocol transitions: "STOP received (term 4), stopping simulation", "RESTART barrier satisfied, restarting in 5s"

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

- [ ] Create `src/components/NodeConfigForm.tsx`
  - [ ] Accept props: `{ nodeId: string, currentConfig: Config, onApply: (config: Partial<Config>) => Promise<void> }`
  - [ ] Inputs for:
    - [ ] Hinge x-position (number input)
    - [ ] Length (number input, validate > 0)
    - [ ] Mass (number input, validate > 0)
    - [ ] Initial angle (number input or slider, validate -180 to 180)
  - [ ] "Apply" button sends `PUT /config` to selected node with all values in one request
  - [ ] Show loading state during apply
  - [ ] Show error state if request fails

### 5.2 Direct Manipulation (Dragging)

- [ ] Extend `src/components/PendulumCanvas.tsx`
  - [ ] Track selected node (from parent state)
  - [ ] Implement drag handlers for SVG elements:
    - [ ] Drag hinge horizontally → update local draft `x` value
    - [ ] Drag bob → update local draft `length` and `angle` values
  - [ ] Show visual feedback during drag (e.g., highlight selected pendulum)
  - [ ] Maintain local draft state separate from authoritative node state
  - [ ] Only send `PUT /config` when user clicks "Apply" (not on every drag movement)

- [ ] Add numeric inputs alongside canvas
  - [ ] Show current values for selected node
  - [ ] Allow precise input via number fields or sliders
  - [ ] Sync with draft state from dragging

### 5.3 Individual Node Controls

- [ ] Extend `src/components/NodeList.tsx`
  - [ ] Add per-node Start/Pause/Stop buttons
  - [ ] Add "Configure" button that shows `NodeConfigForm` in a modal or side panel
  - [ ] Show configuration panel when node is selected

### 5.4 Lifecycle State Display

- [ ] Extend `src/components/NodeList.tsx` or create `src/components/LifecycleIndicator.tsx`
  - [ ] Show lifecycle state: running (green), paused (yellow), stopped (red), restarting (orange)
  - [ ] Show coordination state if available: "Waiting for RESTART (3/5)", "Leader: node-7700"

### 5.5 Improved UX

- [ ] Add loading states
  - [ ] Show "Scanning for nodes..." during initial discovery
  - [ ] Show spinner on nodes being polled
- [ ] Add error states
  - [ ] "Node unreachable" for failed polls
  - [ ] "Partial success: 4/5 nodes started" for group actions
- [ ] Add responsive design
  - [ ] Canvas scales to fit different screen sizes
  - [ ] Controls remain usable on smaller screens
- [ ] Add keyboard accessibility
  - [ ] Tab through nodes and controls
  - [ ] Enter/Space to activate buttons

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

## Section 6: Polish & Production Readiness

**Goal:** Add tests, improve documentation, enable single-command startup, and prepare for submission.

### 6.1 Testing

- [ ] Add Jest or Vitest to `/nodes`
  - [ ] Unit tests for `normalizeAngle()` - edge cases: π, -π, 3π, -3π, 0
  - [ ] Unit tests for `updatePendulum()` - verify semi-implicit Euler behavior
  - [ ] Unit tests for `calculateBobRadius()` - verify mass-to-radius formula
  - [ ] Unit tests for `checkCollision()` - various distances and radii
  - [ ] Unit tests for CLI parsing - valid/invalid inputs, defaults
  - [ ] Unit tests for lifecycle state machine transitions
  - [ ] Integration tests for REST API endpoints (use `supertest`)
    - [ ] GET /status returns correct shape
    - [ ] PUT /config validates and rejects invalid inputs
    - [ ] POST /start, /pause, /stop change lifecycle state
    - [ ] POST /message handles all message types

- [ ] Add Vitest + React Testing Library to `/web`
  - [ ] Component tests for `PendulumCanvas` - renders SVG with correct elements
  - [ ] Component tests for `NodeConfigForm` - inputs and apply button work
  - [ ] Test node discovery service (mock fetch)
  - [ ] Test state polling service (mock fetch)

### 6.2 Single-Command Startup

- [ ] Install `concurrently` in root: `npm install --save-dev concurrently`

- [ ] Create root-level `package.json` with scripts:
  ```json
  {
    "scripts": {
      "install:all": "npm install && cd nodes && npm install && cd ../web && npm install",
      "build:all": "cd nodes && npm run build && cd ../web && npm run build",
      "start:nodes": "concurrently \"cd nodes && npm start\" \"cd nodes && npm start\" \"cd nodes && npm start\" \"cd nodes && npm start\" \"cd nodes && npm start\"",
      "start:web": "cd web && npm run dev",
      "dev": "concurrently \"cd nodes && npm start\" \"cd nodes && npm start\" \"cd nodes && npm start\" \"cd nodes && npm start\" \"cd nodes && npm start\" \"cd web && npm run dev\"",
      "test:nodes": "cd nodes && npm test",
      "test:web": "cd web && npm test"
    }
  }
  ```

- [ ] Create startup script `scripts/start-nodes.sh` (Unix) and `scripts/start-nodes.bat` (Windows)
  - [ ] Starts 5 nodes on ports 7700-7704 (they auto-assign, but this ensures clean startup order)
  - [ ] Optional: add small delay between starts to ensure clean port assignment

- [ ] Optional bonus: Create `docker-compose.yml`
  - [ ] Define services for each node and the web UI
  - [ ] Configure networking and ports
  - [ ] Single `docker-compose up` starts everything

### 6.3 Documentation

- [ ] Update root `README.md`
  - [ ] Architecture diagram (ASCII or embedded image showing nodes + UI)
  - [ ] Explanation of distributed design decisions:
    - [ ] Why leader/lease/election for STOP/RESTART
    - [ ] Why push-based position sharing
    - [ ] Why term-based filtering (avoid split-brain)
  - [ ] Trade-offs:
    - [ ] HTTP polling vs WebSockets (simplicity over real-time)
    - [ ] Semi-implicit Euler vs RK4 (simplicity over precision)
    - [ ] Single-host assumption (scope of challenge)
  - [ ] Known limitations:
    - [ ] No multi-host support
    - [ ] No wind simulation
    - [ ] Collision detection uses latest-known state approximation
  - [ ] How to run: `npm run dev`
  - [ ] How to run tests: `npm test`
  - [ ] CLI parameter reference: `--x`, `--length`, `--mass`, `--angle`

- [ ] Verify `/docs/interfaces.md`, `/docs/coordination.md`, `/docs/physics.md` are complete and accurate (already provided)

### 6.4 Final Polish

- [ ] Add error handling and logging improvements
  - [ ] Graceful shutdown on SIGINT/SIGTERM (close server, log shutdown)
  - [ ] Better error messages in API responses (400 with validation errors, 500 with internal errors)
  - [ ] Request logging middleware in Express (morgan or custom)

- [ ] Add UI polish
  - [ ] Loading skeletons during node discovery
  - [ ] Toast notifications for errors
  - [ ] Responsive design for mobile/tablet
  - [ ] Accessibility audit (aria labels, keyboard navigation)

- [ ] Verify bonus points
  - [ ] TypeScript everywhere ✓
  - [ ] Intuitive configuration UX (dragging + numeric inputs) ✓
  - [ ] Single-command startup (`npm run dev`) ✓
  - [ ] Unit tests for physics and API ✓
  - [ ] (Optional) Wind simulation - intentionally out of scope per physics.md

**Testable outcome:**
- `npm run dev` starts 5 nodes + web UI with one command
- All tests pass: `npm test`
- README clearly explains how to run, test, and understand the system
- A new developer can clone and run the project in under 5 minutes
- Graceful shutdown works (Ctrl+C stops all processes cleanly)

---

## Future Enhancements (Post-MVP)

- [ ] Multi-host support with `--peers=host1,host2` CLI flag [coordination:1]
- [ ] Wind simulation (if spec is updated to allow it) [physics:1]
- [ ] WebSocket-based real-time updates instead of HTTP polling
- [ ] Persistent configuration (save/load from file)
- [ ] Recording and playback of simulations
- [ ] Multi-user collaboration (multiple browsers controlling the same simulation)
- [ ] Deployment scripts for cloud hosting (AWS, Docker, etc.)

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
