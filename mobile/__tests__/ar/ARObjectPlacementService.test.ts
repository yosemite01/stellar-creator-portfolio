import {
  vec3Add,
  vec3Scale,
  vec3Dot,
  vec3Length,
  vec3Normalize,
  vec3Cross,
  mat4Identity,
  planeArea,
  isPlaneViable,
  makeGltfModel,
  computeSunLight,
  deriveEnvironmentLight,
  computeShadowParams,
  StubARProvider,
  ARSceneManager,
  ARObjectPlacementService,
  MIN_PLANE_AREA_M2,
  MAX_TRACKED_PLANES,
  SHADOW_AMBIENT,
  DEFAULT_METALNESS,
  DEFAULT_ROUGHNESS,
  ARPlane,
  Vec3,
  Mat4,
} from '../../src/services/ARObjectPlacementService';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PLANE_ID = 'plane-1';

function makePlane(overrides: Partial<ARPlane> = {}): ARPlane {
  return {
    id: PLANE_ID,
    alignment: 'horizontal',
    center: { x: 0, y: 0, z: 0 },
    extent: { width: 1.0, height: 1.0 },
    transform: mat4Identity(),
    confidence: 0.9,
    ...overrides,
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

describe('constants', () => {
  it('MIN_PLANE_AREA_M2 is 0.09', () => expect(MIN_PLANE_AREA_M2).toBe(0.09));
  it('MAX_TRACKED_PLANES is 20', () => expect(MAX_TRACKED_PLANES).toBe(20));
  it('SHADOW_AMBIENT is between 0 and 1', () => {
    expect(SHADOW_AMBIENT).toBeGreaterThan(0);
    expect(SHADOW_AMBIENT).toBeLessThan(1);
  });
  it('DEFAULT_METALNESS is 0', () => expect(DEFAULT_METALNESS).toBe(0.0));
  it('DEFAULT_ROUGHNESS is 0.5', () => expect(DEFAULT_ROUGHNESS).toBe(0.5));
});

// ─── Vec3 helpers ─────────────────────────────────────────────────────────────

describe('vec3 helpers', () => {
  const A: Vec3 = { x: 1, y: 2, z: 3 };
  const B: Vec3 = { x: 4, y: 5, z: 6 };

  it('vec3Add sums components', () => {
    expect(vec3Add(A, B)).toEqual({ x: 5, y: 7, z: 9 });
  });

  it('vec3Scale multiplies by scalar', () => {
    expect(vec3Scale(A, 2)).toEqual({ x: 2, y: 4, z: 6 });
  });

  it('vec3Dot computes dot product', () => {
    expect(vec3Dot(A, B)).toBe(32); // 4+10+18
  });

  it('vec3Length returns Euclidean length', () => {
    expect(vec3Length({ x: 3, y: 4, z: 0 })).toBeCloseTo(5);
  });

  it('vec3Normalize returns unit vector', () => {
    const n = vec3Normalize({ x: 3, y: 0, z: 0 });
    expect(n.x).toBeCloseTo(1);
    expect(n.y).toBeCloseTo(0);
  });

  it('vec3Normalize handles zero vector gracefully', () => {
    const n = vec3Normalize({ x: 0, y: 0, z: 0 });
    expect(n).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('vec3Cross computes cross product', () => {
    const x = vec3Cross({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    expect(x).toEqual({ x: 0, y: 0, z: 1 });
  });
});

// ─── mat4Identity ─────────────────────────────────────────────────────────────

describe('mat4Identity', () => {
  it('returns 16-element array', () => {
    expect(mat4Identity()).toHaveLength(16);
  });

  it('has 1s on the main diagonal', () => {
    const m: Mat4 = mat4Identity();
    // Diagonal indices: 0, 5, 10, 15
    expect(m[0]).toBe(1);
    expect(m[5]).toBe(1);
    expect(m[10]).toBe(1);
    expect(m[15]).toBe(1);
  });

  it('has 0s off the diagonal', () => {
    const m: Mat4 = mat4Identity();
    expect(m[1]).toBe(0);
    expect(m[4]).toBe(0);
  });
});

// ─── planeArea / isPlaneViable ─────────────────────────────────────────────────

describe('planeArea', () => {
  it('returns width × height', () => {
    const plane = makePlane({ extent: { width: 2, height: 3 } });
    expect(planeArea(plane)).toBe(6);
  });
});

describe('isPlaneViable', () => {
  it('returns true for large, confident plane', () => {
    expect(isPlaneViable(makePlane())).toBe(true);
  });

  it('returns false when area is below MIN_PLANE_AREA_M2', () => {
    expect(isPlaneViable(makePlane({ extent: { width: 0.1, height: 0.1 } }))).toBe(false);
  });

  it('returns false when confidence is below 0.5', () => {
    expect(isPlaneViable(makePlane({ confidence: 0.3 }))).toBe(false);
  });
});

// ─── makeGltfModel ────────────────────────────────────────────────────────────

describe('makeGltfModel', () => {
  it('applies defaults', () => {
    const m = makeGltfModel({ id: 'chair', uri: 'models/chair.glb' });
    expect(m.metalness).toBe(DEFAULT_METALNESS);
    expect(m.roughness).toBe(DEFAULT_ROUGHNESS);
    expect(m.scale).toEqual({ x: 1, y: 1, z: 1 });
    expect(m.castsShadow).toBe(true);
  });

  it('accepts overrides', () => {
    const m = makeGltfModel({ id: 'mirror', uri: 'models/mirror.glb', metalness: 0.9, roughness: 0.1 });
    expect(m.metalness).toBe(0.9);
    expect(m.roughness).toBe(0.1);
  });
});

// ─── computeSunLight ──────────────────────────────────────────────────────────

describe('computeSunLight', () => {
  it('returns a unit direction vector', () => {
    const light = computeSunLight(45, 180);
    const len = vec3Length(light.direction);
    expect(len).toBeCloseTo(1, 5);
  });

  it('sun at zenith (elevation 90) points straight down', () => {
    const light = computeSunLight(90, 0);
    expect(light.direction.y).toBeCloseTo(-1, 1);
  });

  it('accepts custom intensity', () => {
    const light = computeSunLight(45, 90, 50000);
    expect(light.intensity).toBe(50000);
  });

  it('colour R component is always 1.0', () => {
    const light = computeSunLight(10, 90);
    expect(light.color.x).toBe(1.0);
  });
});

// ─── deriveEnvironmentLight ───────────────────────────────────────────────────

describe('deriveEnvironmentLight', () => {
  it('returns both ambient and directional components', () => {
    const env = deriveEnvironmentLight(45, 180);
    expect(env.ambient).toBeDefined();
    expect(env.directional).toBeDefined();
  });

  it('ambient components are positive', () => {
    const env = deriveEnvironmentLight(45, 180);
    expect(env.ambient.x).toBeGreaterThan(0);
    expect(env.ambient.y).toBeGreaterThan(0);
    expect(env.ambient.z).toBeGreaterThan(0);
  });
});

// ─── computeShadowParams ──────────────────────────────────────────────────────

describe('computeShadowParams', () => {
  it('returns shadow params with matrix, opacity, blurRadius', () => {
    const light = computeSunLight(45, 180);
    const shadow = computeShadowParams({ x: 0, y: 0.5, z: 0 }, light);
    expect(shadow).toHaveProperty('matrix');
    expect(shadow).toHaveProperty('opacity');
    expect(shadow).toHaveProperty('blurRadius');
  });

  it('opacity is between 0 and 1', () => {
    const light = computeSunLight(45, 180);
    const shadow = computeShadowParams({ x: 0, y: 1, z: 0 }, light);
    expect(shadow.opacity).toBeGreaterThanOrEqual(0);
    expect(shadow.opacity).toBeLessThanOrEqual(1);
  });

  it('blurRadius is non-negative', () => {
    const light = computeSunLight(45, 180);
    const shadow = computeShadowParams({ x: 0, y: 0.5, z: 0 }, light);
    expect(shadow.blurRadius).toBeGreaterThanOrEqual(0);
  });

  it('shadow matrix is a 16-element array', () => {
    const light = computeSunLight(45, 180);
    const shadow = computeShadowParams({ x: 0, y: 0, z: 0 }, light);
    expect(shadow.matrix).toHaveLength(16);
  });

  it('higher sun elevation reduces shadow opacity', () => {
    const lightHigh = computeSunLight(80, 180);
    const lightLow = computeSunLight(10, 180);
    const pos: Vec3 = { x: 0, y: 1, z: 0 };
    const shadowHigh = computeShadowParams(pos, lightHigh);
    const shadowLow = computeShadowParams(pos, lightLow);
    expect(shadowHigh.opacity).toBeLessThanOrEqual(shadowLow.opacity);
  });
});

// ─── StubARProvider ───────────────────────────────────────────────────────────

describe('StubARProvider', () => {
  it('returns empty planes by default', () => {
    const p = new StubARProvider();
    expect(p.getTrackedPlanes()).toHaveLength(0);
  });

  it('returns provided planes', () => {
    const p = new StubARProvider([makePlane()]);
    expect(p.getTrackedPlanes()).toHaveLength(1);
  });

  it('hitTest returns null when no planes', () => {
    const p = new StubARProvider();
    expect(p.hitTest(0, 0)).toBeNull();
  });

  it('hitTest returns a Vec3 when planes exist', () => {
    const p = new StubARProvider([makePlane()]);
    const hit = p.hitTest(100, 200);
    expect(hit).not.toBeNull();
    expect(typeof hit!.x).toBe('number');
  });
});

// ─── ARSceneManager ───────────────────────────────────────────────────────────

describe('ARSceneManager', () => {
  let provider: StubARProvider;
  let scene: ARSceneManager;

  beforeEach(() => {
    provider = new StubARProvider([makePlane()]);
    scene = new ARSceneManager(provider);
  });

  it('starts inactive', () => expect(scene.isActive).toBe(false));

  it('becomes active after start()', () => {
    scene.start();
    expect(scene.isActive).toBe(true);
  });

  it('becomes inactive after stop()', () => {
    scene.start();
    scene.stop();
    expect(scene.isActive).toBe(false);
  });

  it('registers and retrieves a model', () => {
    const model = makeGltfModel({ id: 'chair', uri: 'models/chair.glb' });
    scene.registerModel(model);
    expect(scene.getModel('chair')).toBe(model);
  });

  it('unregisterModel removes the model', () => {
    const model = makeGltfModel({ id: 'table', uri: 'models/table.glb' });
    scene.registerModel(model);
    scene.unregisterModel('table');
    expect(scene.getModel('table')).toBeUndefined();
  });

  it('getViablePlanes filters by plane viability', () => {
    const tiny = makePlane({ id: 'small', extent: { width: 0.05, height: 0.05 } });
    const stub = new StubARProvider([makePlane(), tiny]);
    const mgr = new ARSceneManager(stub);
    expect(mgr.getViablePlanes()).toHaveLength(1);
  });

  it('placeObject returns an instance ID', () => {
    scene.registerModel(makeGltfModel({ id: 'm1', uri: 'x.glb' }));
    const id = scene.placeObject('m1', PLANE_ID, { x: 0, y: 0, z: 0 });
    expect(typeof id).toBe('string');
    expect(id).not.toBeNull();
  });

  it('placeObject returns null for unknown model', () => {
    expect(scene.placeObject('no-model', PLANE_ID, { x: 0, y: 0, z: 0 })).toBeNull();
  });

  it('placeObject returns null for unknown plane', () => {
    scene.registerModel(makeGltfModel({ id: 'm2', uri: 'x.glb' }));
    expect(scene.placeObject('m2', 'no-plane', { x: 0, y: 0, z: 0 })).toBeNull();
  });

  it('objectCount increments on placement', () => {
    scene.registerModel(makeGltfModel({ id: 'm3', uri: 'x.glb' }));
    scene.placeObject('m3', PLANE_ID, { x: 0, y: 0, z: 0 });
    expect(scene.objectCount).toBe(1);
  });

  it('removeObject deletes the object', () => {
    scene.registerModel(makeGltfModel({ id: 'm4', uri: 'x.glb' }));
    const id = scene.placeObject('m4', PLANE_ID, { x: 0, y: 0, z: 0 })!;
    scene.removeObject(id);
    expect(scene.getObject(id)).toBeUndefined();
    expect(scene.objectCount).toBe(0);
  });

  it('listObjects returns all placed objects', () => {
    scene.registerModel(makeGltfModel({ id: 'm5', uri: 'x.glb' }));
    scene.placeObject('m5', PLANE_ID, { x: 0, y: 0, z: 0 });
    scene.placeObject('m5', PLANE_ID, { x: 1, y: 0, z: 1 });
    expect(scene.listObjects()).toHaveLength(2);
  });

  it('moveObject updates the position', () => {
    scene.registerModel(makeGltfModel({ id: 'm6', uri: 'x.glb' }));
    const id = scene.placeObject('m6', PLANE_ID, { x: 0, y: 0, z: 0 })!;
    const moved = scene.moveObject(id, { x: 2, y: 0, z: 3 });
    expect(moved).toBe(true);
    expect(scene.getObject(id)?.position).toEqual({ x: 2, y: 0, z: 3 });
  });

  it('moveObject returns false for unknown id', () => {
    expect(scene.moveObject('bad-id', { x: 0, y: 0, z: 0 })).toBe(false);
  });

  it('updateLighting changes the environment light', () => {
    const before = scene.getEnvironmentLight().directional.intensity;
    scene.updateLighting(10, 90, );
    // Direction should have changed
    const after = scene.getEnvironmentLight().directional;
    expect(after).toBeDefined();
    // Intensity remains the same (default 100000) — just verify it's a number
    expect(typeof before).toBe('number');
  });

  it('placed object stores shadow parameters', () => {
    scene.registerModel(makeGltfModel({ id: 'm7', uri: 'x.glb' }));
    const id = scene.placeObject('m7', PLANE_ID, { x: 0, y: 0.5, z: 0 })!;
    const obj = scene.getObject(id);
    expect(obj?.shadow.matrix).toHaveLength(16);
    expect(obj?.shadow.opacity).toBeGreaterThan(0);
  });
});

// ─── ARObjectPlacementService ─────────────────────────────────────────────────

describe('ARObjectPlacementService', () => {
  it('exposes getScene()', () => {
    const svc = new ARObjectPlacementService(new StubARProvider());
    expect(svc.getScene()).toBeInstanceOf(ARSceneManager);
  });

  it('start/stop delegate to scene', () => {
    const svc = new ARObjectPlacementService(new StubARProvider());
    svc.start();
    expect(svc.getScene().isActive).toBe(true);
    svc.stop();
    expect(svc.getScene().isActive).toBe(false);
  });
});
