---
title: Pendulum Physics Decisions
purpose: Implementation contract for pendulum motion, geometry, rendering scale, and collision-related physics.
when_needed: Consult when implementing or reviewing the server-side simulation, bob geometry, fixed-time updates, angle handling, rendering, or collision detection.
scope: Gravity-driven pendulum motion and bob geometry; wind is intentionally out of scope.
---

# Pendulum Physics

## Scope

Implement a two-dimensional pendulum consisting of:

- A fixed hinge point.
- A rigid, massless rod of configurable length.
- A spherical bob of configurable mass.
- Gravity.

The rod cannot collide with other rods, bobs, or hinge points. Hinge points cannot register collisions. Only spherical bobs participate in collision detection.

## Units

Lengths, positions, and radii share one distance unit, the same unit used for SVG/world coordinates. One distance unit corresponds to one centimetre and one mass unit to one gram, so the bobs' unit density is 1 g/cm³. Gravity is expressed in the same units, so a default 100-unit pendulum swings with a period of about two seconds.

Wind is out of scope.

## Angle convention

Represent `theta` in radians, measured from the downward vertical:

- `0`: bob directly below its hinge.
- Positive values: bob displaced to one side.
- Negative values: bob displaced to the other side.
- `PI`: bob directly above its hinge.
- `-PI`: equivalent upper position using the opposite signed representation.

The initial angle may be any value from `-PI` through `PI`, including exactly `PI` and `-PI`.

An initial angle of exactly `PI` or `-PI` with zero angular velocity is an unstable equilibrium. Do not reject or clamp the 180-degree case.

After each physics update, normalize `theta` to `[-PI, PI]`. Normalization changes only the representation: equivalent angles such as `PI`, `3 * PI`, and `-PI` represent the same orientation. Do not change angular velocity during normalization.

```ts
function normalizeAngle(angle: number): number {
  const fullTurn = 2 * Math.PI;
  return ((angle + Math.PI) % fullTurn + fullTurn) % fullTurn - Math.PI;
}
```

## Motion equation

Use the full nonlinear equation for every angle:

\[
\alpha = -\frac{g}{L}\sin(\theta)
\]

where:

- `alpha` is angular acceleration in radians per second squared.
- `g` is gravitational acceleration; use `981` distance units per second squared (9.81 m/s² in centimetres).
- `L` is rod length in distance units.
- `theta` is angular position in radians.

Do not replace `sin(theta)` with `theta`. Do not implement a separate linear model. Do not calculate or display an estimated period.

## Fixed timestep and integrator

Run the physics on the server with a fixed timestep of 1/60 second (60 Hz), driven by a server-side timer. The physics timestep must not depend on rendering frequency, client polling, or network-message timing.

Use semi-implicit Euler integration:

```ts
const dt = 1 / 60;
const angularAcceleration = -(gravity / length) * Math.sin(angle);
angularVelocity += angularAcceleration * dt;
angle += angularVelocity * dt;
angle = normalizeAngle(angle);
```

Do not use elapsed wall-clock delay as `dt`. If a timer is delayed, the implementation may process ticks late but should not silently substitute a larger timestep.

## Configuration limits

Use named constants or a centralized configuration object:

```ts
const PHYSICS_HZ = 60;
const MIN_MASS = 35; // radius ≈ 2
const MAX_MASS = 34000; // radius ≈ 20
const MIN_LENGTH = 10;
const MAX_LENGTH = 200;
const MIN_ANGLE_RAD = -Math.PI;
const MAX_ANGLE_RAD = Math.PI;
```

Validate values as finite numbers and reject values outside the configured range. Mass and length must be positive.

## Bob geometry from mass

Treat each bob as a solid sphere whose mass equals its volume (unit density). Derive its radius from mass rather than accepting radius as an independent required input.

For mass `m`:

\[
V = m
\]

\[
r = \sqrt[3]{\frac{3V}{4\pi}}
  = \sqrt[3]{\frac{3m}{4\pi}}
\]

The bob diameter is `2 * radius`.

The default mass of `4200` gives a radius of about `10`.

## Physical and visual geometry

The physical radius is calculated from mass. Rendering may apply a separate configurable visual scale:

```ts
const BOB_VISUAL_SCALE = 1;
const renderedRadius = physicalRadius * BOB_VISUAL_SCALE;
```

Collision detection must use the physical radius, not the rendered radius.

## Position calculation

Given hinge position `(anchorX, anchorY)`, rod length `L`, and angle `theta`, calculate the bob center as:

\[
x = anchorX + L\sin(\theta)
\]

\[
y = anchorY + L\cos(\theta)
\]

This assumes screen/world coordinates where positive `y` points downward. If the renderer uses positive `y` upward, adapt the sign at the rendering boundary.

The rod length is the distance from the hinge to the bob center, not to the bob surface.

## Bob collision detection

Only bob-to-bob collisions are relevant. Do not test rod or hinge collisions.

For two bobs with centers `p1` and `p2` and physical radii `r1` and `r2`:

\[
\|p_1-p_2\| \le r_1+r_2+\varepsilon
\]

Use:

```ts
const COLLISION_MARGIN = 1;
```

Keep the margin separate from bob radii and make it easy to change.

Evaluate collisions using the positions available at evaluation time. Do not reconstruct continuous trajectories between network updates.

When a collision is detected, follow the system-level STOP behavior. Freeze the simulation; do not implement bouncing, momentum transfer, or other collision response.

## Out of scope

- Air resistance or wind.
- Rod elasticity, bending, or rod collisions.
- Bob deformation.
- Collision response.
- Exact continuous-time collision detection.
- Closed-form trajectory or period calculation.
- A separate small-angle approximation.
- Physics updates driven by rendering or network-message timing.
