import { useEffect, useRef, type KeyboardEvent } from 'react';
import {
  AmbientLight,
  Box3,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Sphere,
  Spherical,
  Vector2,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
  type Material as ThreeMaterial,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { DeviceModel, Material } from './deviceModels';
import styles from './diagnostic.module.css';

/**
 * Interactive 3D diagnostic aid (three.js, loaded only inside the repair diagnostic). Generic
 * geometry per device category — never an exact model of a commercial device. Rotate / zoom /
 * pinch with pointer or touch, arrow keys and +/− on the focused viewer, tap a part to select it.
 * Everything here is mirrored by the accessible parts list outside the canvas.
 */
export interface Diagnostic3DProps {
  model: DeviceModel;
  selectable: string[];
  selected: string | null;
  exploded: boolean;
  quality: 'low' | 'high';
  reducedMotion: boolean;
  resetSignal: number;
  label: string;
  onSelect: (key: string) => void;
  onFailure: () => void;
}

const COLORS: Record<Material, { color: number; metalness: number; roughness: number }> = {
  glass: { color: 0x1d2735, metalness: 0.2, roughness: 0.12 },
  body: { color: 0xe8e8ea, metalness: 0.2, roughness: 0.45 },
  board: { color: 0x2f6b4a, metalness: 0.35, roughness: 0.5 },
  battery: { color: 0x3a3d45, metalness: 0.5, roughness: 0.35 },
  metal: { color: 0x9da1a8, metalness: 0.85, roughness: 0.28 },
  dark: { color: 0x1d1f24, metalness: 0.3, roughness: 0.5 },
  lens: { color: 0x0b0c0f, metalness: 0.6, roughness: 0.15 },
  soft: { color: 0x2b2d33, metalness: 0.05, roughness: 0.8 },
};
const HIGHLIGHT = new Color(0xf65311);

interface PartMesh {
  key: string | null;
  mesh: Mesh;
  base: Vector3;
  explode: Vector3;
  material: MeshStandardMaterial;
}

export default function Diagnostic3D(props: Diagnostic3DProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  const apiRef = useRef<{
    update: () => void;
    reset: () => void;
    orbit: (dAzimuth: number, dPolar: number, zoom: number) => void;
  } | null>(null);

  // Latest props for the render loop and event handlers (which read them lazily).
  useEffect(() => {
    propsRef.current = props;
  });

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const { model, quality } = propsRef.current;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({
        canvas,
        antialias: quality === 'high',
        // Transparent: the CSS stage gradient shows through.
        alpha: true,
        powerPreference: quality === 'high' ? 'high-performance' : 'low-power',
      });
    } catch {
      propsRef.current.onFailure();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : 1));
    renderer.shadowMap.enabled = quality === 'high';

    const scene = new Scene();
    const camera = new PerspectiveCamera(35, 1, 0.1, 500);

    scene.add(new AmbientLight(0xffffff, 0.55));
    scene.add(new HemisphereLight(0xffffff, 0x303030, 0.9));
    const key = new DirectionalLight(0xffffff, 2);
    key.position.set(8, 14, 12);
    key.castShadow = quality === 'high';
    scene.add(key);
    const rim = new DirectionalLight(0xf65311, 0.9);
    rim.position.set(-12, 4, -10);
    scene.add(rim);

    const group = new Group();
    scene.add(group);
    const geometries: BufferGeometry[] = [];
    const materials: ThreeMaterial[] = [];
    const parts: PartMesh[] = model.parts.map((part) => {
      const [w, h, d] = part.size;
      const geometry =
        part.shape === 'cylinder'
          ? new CylinderGeometry(w, w, h, quality === 'high' ? 48 : 20)
          : new RoundedBoxGeometry(w, h, d, quality === 'high' ? 4 : 2, part.radius ?? 0.1);
      const palette = COLORS[part.material];
      const material = new MeshStandardMaterial({
        color: palette.color,
        metalness: palette.metalness,
        roughness: palette.roughness,
        transparent: true,
      });
      geometries.push(geometry);
      materials.push(material);
      const mesh = new Mesh(geometry, material);
      mesh.castShadow = quality === 'high';
      mesh.position.set(...part.position);
      if (part.rotation) mesh.rotation.set(...part.rotation);
      mesh.userData.key = part.key;
      group.add(mesh);
      return {
        key: part.key,
        mesh,
        base: new Vector3(...part.position),
        explode: new Vector3(...part.explode),
        material,
      };
    });

    // Frame the whole device, assembled and exploded, whatever the viewport aspect.
    const bounds = new Box3();
    for (const t of [0, 1]) {
      for (const p of parts) p.mesh.position.copy(p.base).addScaledVector(p.explode, t);
      bounds.union(new Box3().setFromObject(group));
    }
    const radius = bounds.getBoundingSphere(new Sphere()).radius;
    const fitDistance = () => {
      const vertical = (camera.fov * Math.PI) / 360;
      const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
      return (radius / Math.sin(Math.min(vertical, horizontal))) * 1.04;
    };

    // Soft floor shadow for depth (high quality only).
    if (quality === 'high') {
      const floor = new Mesh(
        new CircleGeometry(radius * 1.6, 48),
        new MeshStandardMaterial({ color: 0x1b1d22, roughness: 1 }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = bounds.min.y - 0.4;
      floor.receiveShadow = true;
      scene.add(floor);
      geometries.push(floor.geometry);
      materials.push(floor.material as ThreeMaterial);
    }

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = !propsRef.current.reducedMotion;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;

    const home = () => {
      const distance = fitDistance();
      controls.minDistance = distance * 0.4;
      controls.maxDistance = distance * 1.6;
      const s = new Spherical(distance, Math.PI / 2 - model.camera.elevation, model.camera.azimuth);
      camera.position.setFromSpherical(s);
      controls.target.set(0, 0, 0);
      camera.lookAt(0, 0, 0);
      controls.update();
    };
    home();

    let explodeT = propsRef.current.exploded ? 1 : 0;
    let dirty = true;
    let frame = 0;

    const applyLook = () => {
      const { selected, exploded, reducedMotion } = propsRef.current;
      const target = exploded ? 1 : 0;
      if (reducedMotion) explodeT = target;
      else explodeT += (target - explodeT) * 0.18;
      if (Math.abs(target - explodeT) < 0.002) explodeT = target;
      for (const p of parts) {
        p.mesh.position.copy(p.base).addScaledVector(p.explode, explodeT);
        const isSelected = selected !== null && p.key === selected;
        const dim = selected !== null && !isSelected;
        p.material.opacity = dim ? 0.22 : 1;
        p.material.depthWrite = !dim;
        p.material.emissive.copy(isSelected ? HIGHLIGHT : new Color(0x000000));
        p.material.emissiveIntensity = isSelected ? 0.55 : 0;
      }
      return explodeT !== target;
    };

    const resize = () => {
      const { width, height } = host.getBoundingClientRect();
      if (width === 0 || height === 0) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      dirty = true;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    const loop = () => {
      frame = requestAnimationFrame(loop);
      if (document.hidden) return;
      const moving = controls.update();
      const animating = applyLook();
      if (dirty || moving || animating) {
        renderer.render(scene, camera);
        dirty = false;
      }
    };
    loop();

    // Tap / click to select (ignores drags).
    const raycaster = new Raycaster();
    const pointer = new Vector2();
    let down: { x: number; y: number } | null = null;
    const onDown = (event: PointerEvent) => {
      down = { x: event.clientX, y: event.clientY };
    };
    const onUp = (event: PointerEvent) => {
      if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6) return;
      down = null;
      const rect = canvas.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(group.children, false).find((h) => {
        const k = h.object.userData.key as string | null;
        return k !== null && propsRef.current.selectable.includes(k);
      });
      const k = hit?.object.userData.key as string | undefined;
      if (k) propsRef.current.onSelect(k);
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);

    const onLost = (event: Event) => {
      event.preventDefault();
      propsRef.current.onFailure();
    };
    canvas.addEventListener('webglcontextlost', onLost);

    apiRef.current = {
      update: () => {
        dirty = true;
      },
      reset: () => {
        home();
        dirty = true;
      },
      orbit: (dAzimuth, dPolar, zoom) => {
        const offset = camera.position.clone().sub(controls.target);
        const s = new Spherical().setFromVector3(offset);
        s.theta += dAzimuth;
        s.phi = Math.min(Math.max(s.phi + dPolar, 0.2), Math.PI - 0.2);
        s.radius = Math.min(Math.max(s.radius * zoom, controls.minDistance), controls.maxDistance);
        camera.position.copy(controls.target).add(new Vector3().setFromSpherical(s));
        camera.lookAt(controls.target);
        dirty = true;
      },
    };

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('webglcontextlost', onLost);
      controls.dispose();
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      renderer.dispose();
      apiRef.current = null;
    };
    // Rebuilt only when the device model or quality changes; other props are read live.
  }, [props.model, props.quality]);

  useEffect(() => {
    apiRef.current?.update();
  }, [props.selected, props.exploded]);

  useEffect(() => {
    if (props.resetSignal > 0) apiRef.current?.reset();
  }, [props.resetSignal]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const api = apiRef.current;
    if (!api) return;
    const step = 0.18;
    const moves: Record<string, [number, number, number]> = {
      ArrowLeft: [-step, 0, 1],
      ArrowRight: [step, 0, 1],
      ArrowUp: [0, -step, 1],
      ArrowDown: [0, step, 1],
      '+': [0, 0, 0.88],
      '=': [0, 0, 0.88],
      '-': [0, 0, 1.12],
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    api.orbit(...move);
  };

  return (
    // The viewer is a focusable "application" widget (arrow keys orbit, +/- zoom). Every part is
    // also selectable from the accessible parts list next to it.
    // eslint-disable-next-line jsx-a11y-x/no-noninteractive-element-interactions
    <div
      ref={hostRef}
      className={styles.canvasHost}
      // eslint-disable-next-line jsx-a11y-x/no-noninteractive-tabindex
      tabIndex={0}
      role="application"
      aria-roledescription="3D"
      aria-label={props.label}
      onKeyDown={onKeyDown}
    >
      <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
    </div>
  );
}
