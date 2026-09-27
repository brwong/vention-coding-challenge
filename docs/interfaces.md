---
title: Interface decisions
purpose: Implementation guidance for node CLI behavior and the React web UI.
when_to_use: Consult when implementing or changing CLI parsing, node discovery, UI controls, or UI-to-node communication.
scope: CLI and web UI only; do not expand this document into simulation, neighbor protocol, or general REST design.
---

# Interfaces

## Scope and architecture

- The web UI is a separate React service from the pendulum node processes.
- The UI is a client/controller and visualization layer; nodes remain responsible for their own simulation state.
- The UI communicates directly with discovered nodes over HTTP. Do not add a gateway or coordinator service for this category.
- Because the UI and nodes may use different origins/ports during development, configure the nodes to permit requests from the UI origin as needed.
- Use ordinary periodic HTTP polling for node discovery and state updates. Do not implement WebSockets unless a later decision requires them.

## Node CLI

All flags are optional. Nodes bind only to `127.0.0.1`/`localhost`; there is no host flag.

Supported flags:

```text
--x <number>       Optional hinge x-coordinate.
--length <number>  Optional pendulum length.
--mass <number>    Optional bob mass.
--angle <number>   Optional initial angle; positive and negative values are valid.
```

- Do not accept a `--port` flag.
- On startup, try port `7700`; if unavailable, increment and bind to the first available port (`7701`, `7702`, etc.).
- The selected port is runtime-discovered metadata, not a user-configured parameter.
- All numeric flags must be parsed and validated as finite numbers.
- `length` and `mass` must be positive.
- `angle` may be positive, negative, or zero, subject to the simulation's normal range validation.
- If `--x` is omitted, assign the hinge position from discovery/join order at a regular spacing.
- If `--length`, `--mass`, or `--angle` is omitted, use node-defined defaults. Use reasonable initial values that produce a visually well-balanced pendulum; exact values are intentionally changeable later. A suitable initial implementation is `length = 100`, `mass = 4200` (a bob radius of about 10), and `angle = 20` degrees.
- A node may start without CLI parameters, but it should still be configured using defaults and be ready to start. The UI must be able to read those current values before starting.
- CLI-provided values are initial values and may be replaced through the UI before the simulation starts.
- Provide normal `--help` output if the chosen argument parser supports it, but do not add unrelated flags such as `--verbose`, `--host`, or `--port`.

## Discovery and node identity

- The UI periodically scans `http://127.0.0.1:7700`, then increments ports to find nodes.
- Stop a scan after a small handful of consecutive misses, fewer than ten; use a named constant so this can be changed easily.
- Periodic discovery should detect nodes that start or stop after the page loads. A manual refresh may also be provided but is not required.
- The node ID is derived from its selected port, for example `node-7701`.
- Use this generated ID as the primary UI identity; show the port only as supporting/debug information.
- If the x-coordinate was not explicitly set with `--x`, the node should receive or compute a regular position based on discovery/join order. The UI should display the resulting value.

## Web UI behavior

- Render the pendulums with SVG. Use SVG coordinates consistently with the node state and scale the viewport as needed.
- Provide a simulation view rendering every discovered pendulum.
- Provide group controls for `Start`, `Pause`, and `Stop`.
- Provide a group `Reset` control that swings every node back to its configured initial angle and leaves it ready to start, without starting it. This is a direct per-node command like `Start`/`Pause`/`Stop`; it does not involve the epoch-based STOP/RESTART protocol.
- Provide per-node configuration controls for hinge x-position, length, mass, and initial angle.
- Direct manipulation of the selected pendulum should be supported: drag the hinge horizontally to change x-position; drag the bob to change length and angle.
- Provide numeric inputs and/or sliders alongside dragging, so values can be set precisely and the controls remain usable without a mouse.
- Show the selected node using its generated ID.
- Use an editing/setup mode before start. On discovery, read each node's current configuration and initialize the UI from those values. Thus, nodes launched without flags should appear as identical default pendulums except for their positions.
- The user edits local draft values, then clicks one `Apply` button. Apply sends one payload containing all updated settings for the selected node; do not send one request per field or per drag movement.
- Start is available as soon as at least one node has been discovered and is reachable. Nodes are considered start-ready because they always have either CLI values or defaults.
- A clear disabled or error state is still needed for an unreachable node or a rejected configuration.
- Display collision/restart status if node state reports that the group is stopped or waiting; do not invent separate collision behavior in this category.

## UI-to-node communication

- The UI sends configuration changes directly to the selected node over HTTP.
- Dragging updates local draft state while the pointer moves; the single configuration request is sent only when the user clicks `Apply`.
- Start, pause, and stop are group actions issued to all currently discovered, reachable nodes, preferably concurrently.
- The UI must report partial failures instead of pretending a group action succeeded everywhere.
- Poll node state periodically while the simulation is active and less frequently while configuring or stopped.
- Periodically rediscover nodes as well, so newly started or stopped processes are reflected in the UI.
- Stop polling when the UI component is disposed or the page is left.
- Treat reachability and lifecycle state separately: an online node may be stopped, paused, ready, or running.
- Use the node's returned state as authoritative; the UI should not run a second authoritative simulation.

## Deliberately out of scope

- No configurable host, port, verbose, or unrelated CLI flags.
- No WebSocket transport.
- No separate API gateway/coordinator service.
- No detailed REST resource design beyond the HTTP operations needed to discover nodes, read configuration/state, update one node's complete configuration, and invoke lifecycle commands.
- No physics, collision protocol, neighbor communication, or restart algorithm design; those belong to other project documents.
