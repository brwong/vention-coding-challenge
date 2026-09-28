# Pendulum node

One pendulum per process. Binds `127.0.0.1`, first free port from `7700`; ID is `node-<port>`.

## CLI

```sh
npm start -- [--x <n>] [--length <n>] [--mass <n>] [--angle <n>]
```

| Flag | Range | Default |
|---|---|---|
| `--x` | any finite number | `(port - 7700) * 100` |
| `--length` | 10 – 200 (cm) | 100 |
| `--mass` | 35 – 34000 (g) | 4200 (radius ≈ 10) |
| `--angle` | -180 – 180 (degrees) | 20 |
| `-h`, `--help` | | |

- No `--port` or `--host` flag.
- Unknown flags, repeated flags, non-numbers and out-of-range values exit with an error.

## Pendulum physics

Units: cm, g, s. Angle `θ` is in radians, `0` = straight down, positive y points down.

| Quantity | Formula |
|---|---|
| Gravity acceleration | `α_g = -(g / L) · sin θ`, `g = 981` |
| Integrator (60 Hz, `dt = 1/60`) | `ω += α·dt`, `θ += ω·dt`, then wrap `θ` to `[-π, π)` |
| Bob radius (density 1) | `r = ∛(3m / 4π)` |
| Bob center | `x = x_hinge + L·sin θ`, `y = 0 + L·cos θ` |
| Collision | `‖p₁ - p₂‖ ≤ r₁ + r₂ + 1` |

## Wind physics

| Quantity | Formula |
|---|---|
| Wind velocity | `v_w = (±speed, 0)` (`+` = right) |
| Bob velocity | `v_b = (L·cos θ·ω, -L·sin θ·ω)` |
| Relative velocity | `v_rel = v_w - v_b` |
| Drag force | `F = ½ · ρ · C_d · πr² · ‖v_rel‖ · v_rel` |
| Tangent | `t̂ = (cos θ, -sin θ)` |
| Wind acceleration | `α_w = (F · t̂) / (m·L)` |
| Total | `α = α_g + α_w` |

## REST API

JSON over HTTP. CORS allows any `localhost` / `127.0.0.1` origin.

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/status` | | `{ nodeId, port, state, config, lifecycle }` |
| `GET` | `/config` | | `{ x, length, mass, angle }` |
| `PUT` | `/config` | any subset of `{ x, length, mass, angle }` | updated config |
| `POST` | `/start` | | `{ lifecycle }` |
| `POST` | `/pause` | | `{ lifecycle }` |
| `POST` | `/stop` | | `{ lifecycle }` |
| `POST` | `/reset` | | `{ lifecycle }` |
| `PUT` | `/wind` | `{ enabled: true, direction, speed, airDensity, dragCoefficient }` | the wind config |
| `DELETE` | `/wind` | | `{ enabled: false }` |
| `GET` | `/protocol-status` | | `{ nodeId, epoch, lifecycle, restartBarrier, awaitingRestart, quorumSize, stoppedBy, peers[] }` |
| `POST` | `/message` | peer message | peer-to-peer only |

### `/status` shape

```ts
{
  nodeId: string,             // "node-7700"
  port: number,
  state: {
    angle: number,            // radians
    angularVelocity: number,  // rad/s
    running: boolean,
    stopped: boolean,
    restarting: boolean,
  },
  config: { x, length, mass, angle },  // angle in degrees
  lifecycle: "ready" | "running" | "paused" | "stopped" | "restarting",
}
```

### Behavior

- `PUT /config`: validated with the CLI's limits (angle in degrees); resets the pendulum to the new initial angle.
- `/start`: resumes after `pause`; after `stop`, swings again from the initial angle.
- `/pause`, `/stop`: freeze in place.
- `/reset`: back to the initial angle, wind off, lifecycle `ready`.
- A collision restart also turns wind off.
- Wind is not shown in `/status`.

### Wind validation

| Field | Rule |
|---|---|
| `enabled` | `true` |
| `direction` | `"left"` or `"right"` |
| `speed` | 0 – 10000 (cm/s) |
| `airDensity` | > 0 (g/cm³); default `0.001225` |
| `dragCoefficient` | ≥ 0; default `0.47` |

### Errors

| Status | When |
|---|---|
| `400 { error }` | invalid config, wind body, message or JSON |
| `404 { error }` | unknown route |
| `500 { error }` | unexpected failure |
