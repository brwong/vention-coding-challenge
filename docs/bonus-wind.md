---
title: Bonus Wind Physics
purpose: Implementation contract for adding simplified constant wind to the pendulum simulation, including its REST API.
when_needed: Consult when implementing or reviewing the optional wind API, wind configuration, force calculation, integration, reset behavior, or tests.
scope: Constant horizontal wind acting on spherical bobs; excludes gusts and advanced fluid dynamics.
---

# Bonus Wind Physics

## Scope

Add an optional wind force to the existing two-dimensional pendulum simulation.

The pendulum remains:

- A fixed hinge point.
- A rigid, massless rod.
- A spherical bob.
- A configurable mass and length.
- A gravity-driven nonlinear simulation using the existing fixed timestep.

Wind must not change the existing angle convention, timestep, bob geometry, collision rules, or STOP behavior.

## Units

Use the simulation's units from the physics document: distance in centimetres, mass in grams, and time in seconds. Wind speed is therefore in cm/s, air density in g/cm³, and force in dynes (g·cm/s²). Convert SI reference values before use; for example, 5 m/s is `500` cm/s and 1.225 kg/m³ is `0.001225` g/cm³.

## Wind control

Wind is constant while enabled. It has no gusts or time-varying behavior.

Wind is horizontal and has one of two directions:

```ts
type WindDirection = "left" | "right";
```

Wind speed is non-negative and is controlled externally, such as by a UI slider. The UI does not need to expose the entire permitted range.

Wind state is not required in ordinary node state responses. The UI or coordinating layer owns the displayed wind state and sends commands to each node. Nodes maintain their local wind state for simulation purposes.

Resetting the simulation must disable wind in the UI and on every node.

## REST API

Each node must expose these operations. Exact route prefixes may follow the project’s existing API convention, but the operation semantics and payloads should remain equivalent.

### Enable or update wind

```http
PUT /wind
Content-Type: application/json
```

Request:

```json
{
  "enabled": true,
  "direction": "left",
  "speed": 500,
  "airDensity": 0.001225,
  "dragCoefficient": 0.47
}
```

The request replaces the node’s current wind configuration and enables wind locally.

### Disable wind

```http
DELETE /wind
```

Alternatively, an implementation may use `PUT /wind` with `{ "enabled": false }`, but the chosen API should be consistent across all nodes. The preferred form is `DELETE /wind` because disabling wind is a distinct operation and requires no configuration payload.

A successful request should return a 2xx response. A malformed or invalid request should return a 4xx response. Unexpected internal failures should return an appropriate 5xx response.

The UI should send the corresponding request to every node. No acknowledgement protocol is required. A non-2xx response, timeout, or other request failure should place the UI into an appropriate wind-command error state and should not be presented as successfully applied to that node.

### Reset behavior

The existing simulation reset operation must also disable wind:

- The UI clears its wind configuration and displays wind as off.
- Each node clears its local wind configuration.
- Subsequent physics ticks use gravity only until a new wind-on request is received.

## Wind-on request schema

```ts
type WindOnRequest = {
  enabled: true;
  direction: "left" | "right";
  speed: number;                 // cm/s, non-negative
  airDensity: number;            // g/cm³
  dragCoefficient: number;
};
```

Wind-off state is represented internally as disabled configuration. The preferred public operation is `DELETE /wind`.

## Existing motion model

Use the existing angle convention:

- `theta = 0`: bob directly below its hinge.
- Positive and negative values: displacement to either side.
- `theta = PI` or `-PI`: bob directly above its hinge.

Use the existing gravity term:

\[
\alpha_g = -\frac{g}{L}\sin(\theta)
\]

Continue using the fixed 60 Hz server-side timestep, semi-implicit Euler integration, and angle normalization to `[-PI, PI]`.

## Bob area

Treat the bob as a sphere. Use its projected circular area facing the wind:

\[
A = \pi r^2
\]

where `r` is the physical bob radius calculated from mass.

Do not use the sphere’s total surface area `4 * PI * r²` for drag.

## Relative wind model

Use relative velocity rather than treating wind as a fixed force.

The horizontal wind velocity is:

```ts
const windVelocityX = direction === "right" ? speed : -speed;
const windVelocityY = 0;
```

The bob’s Cartesian velocity is derived from angular velocity:

\[
v_x = L\cos(\theta)\dot\theta
\]

\[
v_y = -L\sin(\theta)\dot\theta
\]

where `thetaDot` is angular velocity.

Calculate relative air velocity as wind velocity minus bob velocity:

\[
\vec v_{rel} = \vec v_{wind} - \vec v_{bob}
\]

Let:

\[
|v_{rel}| = \sqrt{v_{rel,x}^2 + v_{rel,y}^2}
\]

The drag force vector is:

\[
\vec F_w = \frac{1}{2}\rho C_d A |v_{rel}|\vec v_{rel}
\]

This formulation preserves the force direction while making force magnitude proportional to relative speed squared.

## Tangential force and acceleration

With positive `y` downward, use:

\[
\hat t = (\cos\theta, -\sin\theta)
\]

as the pendulum’s tangential unit vector.

Project wind force onto the tangent:

\[
F_t = \vec F_w \cdot \hat t
\]

Convert tangential force to angular acceleration:

\[
\alpha_w = \frac{F_t}{mL}
\]

Total angular acceleration:

\[
\alpha = \alpha_g + \alpha_w
\]

If wind is disabled, use only `alpha_g`.

## Suggested update structure

```ts
const radius = bob.radius;
const area = Math.PI * radius ** 2;

const bobVelocity = {
  x: length * Math.cos(angle) * angularVelocity,
  y: -length * Math.sin(angle) * angularVelocity,
};

const windVelocity = wind.enabled
  ? {
      x: wind.direction === "right" ? wind.speed : -wind.speed,
      y: 0,
    }
  : { x: 0, y: 0 };

const relativeVelocity = {
  x: windVelocity.x - bobVelocity.x,
  y: windVelocity.y - bobVelocity.y,
};

const relativeSpeed = Math.hypot(
  relativeVelocity.x,
  relativeVelocity.y,
);

const dragScale =
  0.5 * wind.airDensity * wind.dragCoefficient * area * relativeSpeed;

const windForce = {
  x: dragScale * relativeVelocity.x,
  y: dragScale * relativeVelocity.y,
};

const tangent = {
  x: Math.cos(angle),
  y: -Math.sin(angle),
};

const tangentialForce =
  windForce.x * tangent.x + windForce.y * tangent.y;

const windAcceleration = tangentialForce / (mass * length);
const gravityAcceleration = -(gravity / length) * Math.sin(angle);
const angularAcceleration = gravityAcceleration + windAcceleration;

angularVelocity += angularAcceleration * dt;
angle += angularVelocity * dt;
angle = normalizeAngle(angle);
```

## Initial constants and validation

Keep default values and limits centralized:

```ts
const DEFAULT_AIR_DENSITY = 0.001225; // g/cm³ (1.225 kg/m³)
const DEFAULT_SPHERE_DRAG_COEFFICIENT = 0.47;
const MIN_WIND_SPEED = 0; // cm/s
const MAX_WIND_SPEED = 10000; // cm/s (100 m/s)
```

`MAX_WIND_SPEED` is a hard validation cap. It is intentionally higher than the UI’s expected slider range so the API remains safe without requiring the UI to expose extreme values. The cap may be changed through centralized configuration if testing shows that a different range is appropriate.

Suggested UI slider range: `0` through `5000` cm/s (0–50 m/s). Wind has little visible effect on the default bob below about 2000 cm/s. The table below lists the steady-state lean angle, `atan(F / (m * g))`, for the default bob (mass `4200`, radius ≈ `10`) at rest under wind with the default air density and drag coefficient:

| Wind speed (cm/s) | Equivalent (m/s) | Steady-state lean |
| ---: | ---: | ---: |
| 500 | 5 | 0.3° |
| 1000 | 10 | 1.3° |
| 2000 | 20 | 5.0° |
| 3000 | 30 | 11.2° |
| 5000 | 50 | 28.8° |
| 10000 | 100 | 65.5° |

Heavier bobs lean less and lighter bobs lean more, so bobs with different masses will settle at different angles under the same wind.

Do not add an arbitrary force or acceleration clamp unless instability is observed and the limit is documented separately.

For wind-on requests, validate:

- `enabled` is `true`.
- `direction` is `"left"` or `"right"`.
- `speed` is finite and within `0` through `MAX_WIND_SPEED`.
- `airDensity` is finite and positive.
- `dragCoefficient` is finite and non-negative.

## Assumptions

- Wind is uniform, horizontal, and constant while enabled.
- Direction is limited to left or right.
- The bob is spherical.
- The bob’s projected area is `PI * radius²`.
- Wind force acts at the bob center.
- Only the tangential component changes the pendulum angle.
- Relative wind velocity includes the bob’s current Cartesian velocity.
- The rod remains rigid and is not itself affected by wind.
- Wind configuration is delivered independently to each node by an external caller.
- Ordinary node state responses do not need to include wind state.
- Reset disables wind everywhere.

## Tests

Add tests for:

- Wind disabled produces the gravity-only result.
- Zero wind speed produces no wind force.
- Left and right wind produce opposite force directions.
- Relative velocity changes as the bob moves.
- Increasing wind speed increases force magnitude.
- Increasing bob mass decreases wind-induced angular acceleration for the same geometry and wind.
- Bob radius and projected area are calculated correctly.
- A bob at `PI` or `-PI` can be displaced by enabled wind.
- Invalid wind requests are rejected.
- Wind speed above the maximum is rejected.
- `PUT /wind` enables or replaces local wind state.
- `DELETE /wind` disables local wind state.
- Reset disables local wind state.
- Failed node requests are surfaced as UI error state rather than success.

## Out of scope

- Gusts or time-varying wind.
- Arbitrary wind directions.
- Turbulence.
- Airflow around the rod.
- Lift forces.
- Buoyancy.
- Reynolds-number-dependent drag coefficients.
- Continuous-time collision prediction.
- Wind-driven collision response.
- Physical bouncing after collision.
- Acknowledgement or synchronization protocol for wind updates.
