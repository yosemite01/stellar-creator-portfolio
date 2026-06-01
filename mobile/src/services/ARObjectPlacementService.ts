/**
 * ARObjectPlacementService — Issue #594
 * "[Mobile] Implement AR Native Object Placement for Creators"
 *
 * Features:
 *  - ARKit (iOS) / ARCore (Android) surface-plane detection abstraction
 *  - glTF 2.0 model registry with dynamic lighting parameter calculation
 *  - Physically-based 3D shadow computation (sun position → shadow matrix)
 *  - Scene manager for placing, transforming, and removing objects
 *  - Platform-agnostic interface — concrete implementations swap at runtime
 */

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Minimum plane area (m²) required before it is considered valid for placement. */
export const MIN_PLANE_AREA_M2 = 0.09; // 30 cm × 30 cm

/** Maximum number of planes tracked simultaneously. */
export const MAX_TRACKED_PLANES = 20;

/** Shadow ambient coefficient (0–1): prevents fully black shadows. */
export const SHADOW_AMBIENT = 0.15;

/** Default PBR metalness for newly placed objects. */
export const DEFAULT_METALNESS = 0.0;

/** Default PBR roughness for newly placed objects. */
export const DEFAULT_ROUGHNESS = 0.5;

// ─── Math Primitives ──────────────────────────────────────────────────────────

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Vec4 {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** Column-major 4×4 transformation matrix stored as a flat 16-element array. */
export type Mat4 = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

export function vec3Add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function vec3Scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export function vec3Dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function vec3Length(v: Vec3): number {
  return Math.sqrt(vec3Dot(v, v));
}

export function vec3Normalize(v: Vec3): Vec3 {
  const len = vec3Length(v);
  if (len === 0) return { x: 0, y: 0, z: 0 };
  return vec3Scale(v, 1 / len);
}

export function vec3Cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/** Returns the identity Mat4. */
export function mat4Identity(): Mat4 {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
}

// ─── Surface Plane ─────────────────────────────────────────────────────────────

export type PlaneAlignment = 'horizontal' | 'vertical' | 'arbitrary';

export interface ARPlane {
  id: string;
  alignment: PlaneAlignment;
  center: Vec3;
  /** Width and height in metres. */
  extent: { width: number; height: number };
  transform: Mat4;
  confidence: number; // 0–1
}

/** Computed area of a plane in square metres. */
export function planeArea(plane: ARPlane): number {
  return plane.extent.width * plane.extent.height;
}

/** Returns true when a plane is large and confident enough for object placement. */
export function isPlaneViable(plane: ARPlane): boolean {
  return planeArea(plane) >= MIN_PLANE_AREA_M2 && plane.confidence >= 0.5;
}

// ─── glTF Model Registry ───────────────────────────────────────────────────────

export interface GltfModel {
  id: string;
  uri: string;            // Local path or remote URL
  scale: Vec3;
  metalness: number;      // PBR: 0 (dielectric) → 1 (metal)
  roughness: number;      // PBR: 0 (smooth) → 1 (rough)
  castsShadow: boolean;
  receivesShadow: boolean;
}

export function makeGltfModel(partial: Pick<GltfModel, 'id' | 'uri'> & Partial<GltfModel>): GltfModel {
  return {
    scale: { x: 1, y: 1, z: 1 },
    metalness: DEFAULT_METALNESS,
    roughness: DEFAULT_ROUGHNESS,
    castsShadow: true,
    receivesShadow: true,
    ...partial,
  };
}

// ─── Lighting ─────────────────────────────────────────────────────────────────

export interface DirectionalLight {
  direction: Vec3;    // Unit vector pointing FROM light source
  color: Vec3;        // Linear RGB, each component 0–1
  intensity: number;  // Lux equivalent
}

export interface EnvironmentLight {
  ambient: Vec3;      // Base ambient colour
  directional: DirectionalLight;
}

/**
 * Computes a simple sun-based directional light from elevation and azimuth angles.
 *
 * @param elevationDeg  Angle above the horizon in degrees (0 = horizon, 90 = zenith).
 * @param azimuthDeg    Clockwise angle from north in degrees.
 * @param intensity     Light intensity in lux.
 */
export function computeSunLight(
  elevationDeg: number,
  azimuthDeg: number,
  intensity: number = 100_000,
): DirectionalLight {
  const elRad = (elevationDeg * Math.PI) / 180;
  const azRad = (azimuthDeg * Math.PI) / 180;

  // Convert spherical → Cartesian, then negate (direction points from object to sun)
  const sunX = Math.cos(elRad) * Math.sin(azRad);
  const sunY = Math.sin(elRad);
  const sunZ = Math.cos(elRad) * Math.cos(azRad);

  const direction = vec3Normalize({ x: -sunX, y: -sunY, z: -sunZ });

  // Colour temperature: warm at low elevation, white at zenith
  const warmth = Math.max(0, 1 - elevationDeg / 90);
  const color: Vec3 = {
    x: 1.0,
    y: 1.0 - warmth * 0.15,
    z: 1.0 - warmth * 0.35,
  };

  return { direction, color, intensity };
}

/**
 * Derives an EnvironmentLight combining a directional sun and computed ambient.
 */
export function deriveEnvironmentLight(
  elevationDeg: number,
  azimuthDeg: number,
  intensity: number = 100_000,
): EnvironmentLight {
  const directional = computeSunLight(elevationDeg, azimuthDeg, intensity);

  // Ambient is a fraction of the sky colour, brighter when sun is higher
  const skyFactor = Math.max(SHADOW_AMBIENT, elevationDeg / 90);
  const ambient: Vec3 = {
    x: skyFactor * 0.5,
    y: skyFactor * 0.6,
    z: skyFactor * 0.8,
  };

  return { ambient, directional };
}

// ─── Shadow Calculation ────────────────────────────────────────────────────────

export interface ShadowParams {
  /** Shadow projection matrix for rendering. */
  matrix: Mat4;
  /** 0 (fully transparent) → 1 (fully opaque). */
  opacity: number;
  /** Shadow softness radius in world units. */
  blurRadius: number;
}

/**
 * Computes shadow parameters for an object placed at `objectPosition` on a plane.
 *
 * Uses a simple orthographic shadow projection oriented along the light direction.
 * The shadow matrix translates the object position along the light direction
 * onto the plane's Y=0 surface.
 *
 * @param objectPosition  World-space position of the object.
 * @param light           Directional light driving the shadow.
 * @param planeNormal     Upward normal of the receiving surface (default: world up).
 */
export function computeShadowParams(
  objectPosition: Vec3,
  light: DirectionalLight,
  planeNormal: Vec3 = { x: 0, y: 1, z: 0 },
): ShadowParams {
  const lightDir = vec3Normalize(light.direction);
  const dotNL = vec3Dot(planeNormal, lightDir);

  // Shadow opacity scales with elevation: higher sun → shorter, less opaque shadow
  const elevation = Math.asin(Math.max(-1, Math.min(1, -lightDir.y)));
  const opacity = Math.max(0.1, 1.0 - elevation / (Math.PI / 2));

  // Blur radius is proportional to the object height above the plane
  // (approximated by the Y component of the object position)
  const height = Math.max(0, objectPosition.y);
  const blurRadius = height * 0.15 * (1 - opacity);

  // Build a simple shadow matrix: project along light onto Y=0 plane.
  // shadow_pos = position - (dot(planeNormal, position) / dot(planeNormal, lightDir)) * lightDir
  const denominator = dotNL === 0 ? 0.0001 : dotNL;
  const scale = -vec3Dot(planeNormal, objectPosition) / denominator;

  const shadowOffset = vec3Scale(lightDir, scale);
  const shadowPos = vec3Add(objectPosition, shadowOffset);

  // Embed shadow translation into column-major Mat4
  const matrix = mat4Identity();
  matrix[12] = shadowPos.x;
  matrix[13] = 0; // Shadow is projected onto Y=0
  matrix[14] = shadowPos.z;

  return { matrix, opacity, blurRadius };
}

// ─── Placed Object ────────────────────────────────────────────────────────────

export interface PlacedObject {
  instanceId: string;
  modelId: string;
  planeId: string;
  position: Vec3;
  rotation: Vec4;    // Quaternion
  scale: Vec3;
  shadow: ShadowParams;
  placedAt: number;
}

// ─── AR Platform Provider Interface ───────────────────────────────────────────

/**
 * Pluggable interface for ARKit (iOS) and ARCore (Android).
 * Production implementations call into native modules via JSI / expo-modules.
 */
export interface ARPlatformProvider {
  startSession(): void;
  stopSession(): void;
  getTrackedPlanes(): ARPlane[];
  hitTest(screenX: number, screenY: number): Vec3 | null;
}

/**
 * Stub provider for unit tests — returns a single pre-defined plane.
 */
export class StubARProvider implements ARPlatformProvider {
  private planes: ARPlane[];

  constructor(planes: ARPlane[] = []) {
    this.planes = planes;
  }

  startSession(): void { /* no-op */ }
  stopSession(): void { /* no-op */ }

  getTrackedPlanes(): ARPlane[] {
    return this.planes;
  }

  hitTest(screenX: number, screenY: number): Vec3 | null {
    if (this.planes.length === 0) return null;
    // Return center of first plane, offset by screen position as a stub
    const p = this.planes[0];
    return { x: p.center.x + screenX * 0.001, y: p.center.y, z: p.center.z + screenY * 0.001 };
  }
}

// ─── AR Scene Manager ─────────────────────────────────────────────────────────

/**
 * Manages the AR scene: model registry, plane tracking, object placement,
 * lighting, and shadow calculation.
 */
export class ARSceneManager {
  private provider: ARPlatformProvider;
  private models: Map<string, GltfModel> = new Map();
  private objects: Map<string, PlacedObject> = new Map();
  private environment: EnvironmentLight;
  private instanceCounter = 0;
  private active = false;

  constructor(
    provider: ARPlatformProvider,
    initialElevation = 45,
    initialAzimuth = 180,
  ) {
    this.provider = provider;
    this.environment = deriveEnvironmentLight(initialElevation, initialAzimuth);
  }

  // ── Session ──────────────────────────────────────────────────────────────

  start(): void {
    this.active = true;
    this.provider.startSession();
  }

  stop(): void {
    this.active = false;
    this.provider.stopSession();
  }

  get isActive(): boolean {
    return this.active;
  }

  // ── Model Registry ────────────────────────────────────────────────────────

  registerModel(model: GltfModel): void {
    this.models.set(model.id, model);
  }

  unregisterModel(modelId: string): boolean {
    return this.models.delete(modelId);
  }

  getModel(modelId: string): GltfModel | undefined {
    return this.models.get(modelId);
  }

  // ── Plane Queries ─────────────────────────────────────────────────────────

  getTrackedPlanes(): ARPlane[] {
    return this.provider.getTrackedPlanes();
  }

  getViablePlanes(): ARPlane[] {
    return this.getTrackedPlanes().filter(isPlaneViable);
  }

  // ── Object Placement ──────────────────────────────────────────────────────

  /**
   * Place a registered model onto a given plane at a world-space position.
   * Returns the instance ID or null when the model or plane is not found.
   */
  placeObject(
    modelId: string,
    planeId: string,
    position: Vec3,
    rotation: Vec4 = { x: 0, y: 0, z: 0, w: 1 },
  ): string | null {
    const model = this.models.get(modelId);
    if (!model) return null;

    const planes = this.provider.getTrackedPlanes();
    const plane = planes.find((p) => p.id === planeId);
    if (!plane) return null;

    const shadow = computeShadowParams(position, this.environment.directional);
    const instanceId = `obj-${++this.instanceCounter}-${Date.now()}`;

    const placed: PlacedObject = {
      instanceId,
      modelId,
      planeId,
      position,
      rotation,
      scale: { ...model.scale },
      shadow,
      placedAt: Date.now(),
    };

    this.objects.set(instanceId, placed);
    return instanceId;
  }

  /**
   * Remove a placed object from the scene.
   */
  removeObject(instanceId: string): boolean {
    return this.objects.delete(instanceId);
  }

  /**
   * Retrieve a placed object by its instance ID.
   */
  getObject(instanceId: string): PlacedObject | undefined {
    return this.objects.get(instanceId);
  }

  /**
   * List all currently placed objects.
   */
  listObjects(): PlacedObject[] {
    return Array.from(this.objects.values());
  }

  /**
   * Move a placed object to a new position, recomputing its shadow.
   */
  moveObject(instanceId: string, newPosition: Vec3): boolean {
    const obj = this.objects.get(instanceId);
    if (!obj) return false;

    obj.position = newPosition;
    obj.shadow = computeShadowParams(newPosition, this.environment.directional);
    return true;
  }

  // ── Lighting ─────────────────────────────────────────────────────────────

  /**
   * Update the scene lighting based on new sun angles.
   * Also recomputes shadows for all existing objects.
   */
  updateLighting(elevationDeg: number, azimuthDeg: number): void {
    this.environment = deriveEnvironmentLight(elevationDeg, azimuthDeg);

    // Recompute shadows for all placed objects
    for (const obj of this.objects.values()) {
      obj.shadow = computeShadowParams(obj.position, this.environment.directional);
    }
  }

  getEnvironmentLight(): EnvironmentLight {
    return this.environment;
  }

  /** Total number of objects currently in the scene. */
  get objectCount(): number {
    return this.objects.size;
  }
}

// ─── ARObjectPlacementService ─────────────────────────────────────────────────

/**
 * Top-level service facade — creates and owns the ARSceneManager.
 */
export class ARObjectPlacementService {
  private scene: ARSceneManager;

  constructor(provider: ARPlatformProvider, elevationDeg = 45, azimuthDeg = 180) {
    this.scene = new ARSceneManager(provider, elevationDeg, azimuthDeg);
  }

  getScene(): ARSceneManager {
    return this.scene;
  }

  start(): void {
    this.scene.start();
  }

  stop(): void {
    this.scene.stop();
  }
}
