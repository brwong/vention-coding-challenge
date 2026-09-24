export const DEFAULT_LENGTH = 100;
export const DEFAULT_MASS = 4200; // bob radius ≈ 10
export const DEFAULT_ANGLE_DEG = 20;

export const MIN_ANGLE_DEG = -180;
export const MAX_ANGLE_DEG = 180;

export const HOST = "127.0.0.1";
export const BASE_PORT = 7700;
export const MAX_PORT_SEARCH = 100; // prevent infinite loop

export const STATUS_LOG_INTERVAL_MS = 1000;

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
