export const DEFAULT_LENGTH = 100;
export const DEFAULT_MASS = 4200; // bob radius ≈ 10
export const DEFAULT_ANGLE_DEG = 20;

export const MIN_ANGLE_DEG = -180;
export const MAX_ANGLE_DEG = 180;

export const HOST = "127.0.0.1";
export const BASE_PORT = 7700;
export const MAX_PORT_SEARCH = 100; // prevent infinite loop

export const STATUS_LOG_INTERVAL_MS = 500;

export const SPACING = 100; // default distance between hinges
export const HINGE_Y = 0; // all hinges share one height; positive y points down

export const PHYSICS_HZ = 60;
export const DT = 1 / PHYSICS_HZ;
export const GRAVITY = 981; // distance units/s² (1 unit = 1 cm; 100-unit period ≈ 2 s)
export const COLLISION_MARGIN = 1; // distance units
export const MIN_MASS = 35; // bob radius ≈ 2
export const MAX_MASS = 34000; // bob radius ≈ 20
export const MIN_LENGTH = 10;
export const MAX_LENGTH = 200;
export const MIN_ANGLE_RAD = -Math.PI;
export const MAX_ANGLE_RAD = Math.PI;

// Coordination timing. These are local timers only; nodes never compare clocks.
export const MESSAGE_TIMEOUT_MS = 500; // give up on a peer request after this long
export const HEARTBEAT_INTERVAL_MS = 500;
export const PEER_SUSPECT_MS = 2000; // silent this long: suspected dead
export const PEER_TIMEOUT_MS = 10000; // silent this long: removed from the peer list
export const ELECTION_TIMEOUT_MS = 2000; // no leader heartbeat this long: start an election
export const ELECTION_JITTER_MS = 500; // random extra wait so followers rarely run at once
export const ELECTION_CHECK_INTERVAL_MS = 100;
