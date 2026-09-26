import type { REPAIR_MODEL_KINDS } from '@/domain/settings/schemas';

/**
 * Generic, category-level diagnostic models (NOT exact replicas of any commercial device). Shared
 * by the 3D viewer (three.js primitives) and the 2D fallback (SVG). Part keys match the repair
 * catalog's component keys; parts without a key are decorative (frame, strap, …).
 * Units are centimetres; `explode` is the offset applied in the exploded view.
 */
export type ModelKind = Exclude<(typeof REPAIR_MODEL_KINDS)[number], 'none'>;
export type Material = 'glass' | 'body' | 'board' | 'battery' | 'metal' | 'dark' | 'lens' | 'soft';
type Vec3 = [number, number, number];

export interface PartSpec {
  /** Repair component key (selectable) or null for decorative geometry. */
  key: string | null;
  shape: 'box' | 'cylinder';
  size: Vec3; // box: w,h,d — cylinder: radius, height, (unused)
  position: Vec3;
  rotation?: Vec3;
  radius?: number; // rounded box corner radius
  material: Material;
  explode: Vec3;
  /** 2D fallback rectangle in a 100 × 100 viewBox (x, y, w, h, corner radius); decorative parts have none. */
  flat?: [number, number, number, number, number];
  /** Internal part (drawn dashed in the 2D diagram). */
  inside?: boolean;
}

export interface DeviceModel {
  kind: ModelKind;
  parts: PartSpec[];
  /** Camera distance multiplier and initial tilt. */
  camera: { elevation: number; azimuth: number };
  /** 2D device outlines (e.g. front and back view) in the 100 × 100 viewBox. */
  outlines: [number, number, number, number, number][];
}

const phone: DeviceModel = {
  kind: 'smartphone',
  camera: { elevation: 0.35, azimuth: -0.55 },
  outlines: [
    [8, 6, 36, 88, 7],
    [56, 6, 36, 88, 7],
  ],
  parts: [
    {
      key: null,
      shape: 'box',
      size: [7.2, 15, 0.82],
      position: [0, 0, 0],
      radius: 0.9,
      material: 'metal',
      explode: [0, 0, 0],
    },
    {
      key: 'screen',
      shape: 'box',
      size: [6.9, 14.7, 0.12],
      position: [0, 0, 0.44],
      radius: 0.8,
      material: 'glass',
      explode: [0, 0, 4.2],
      flat: [10, 8, 32, 84, 6],
    },
    {
      key: 'board',
      shape: 'box',
      size: [5.9, 5.4, 0.14],
      position: [0, 4, 0.12],
      radius: 0.2,
      material: 'board',
      explode: [0, 0.6, 2.4],
      inside: true,
      flat: [62, 28, 24, 22, 2],
    },
    {
      key: 'battery',
      shape: 'box',
      size: [5.6, 7.4, 0.38],
      position: [0, -2.4, 0.06],
      radius: 0.3,
      material: 'battery',
      explode: [0, -0.4, 1.4],
      inside: true,
      flat: [62, 52, 24, 30, 3],
    },
    {
      key: 'speakers',
      shape: 'box',
      size: [1.8, 0.7, 0.3],
      position: [-1.9, -6.6, 0.05],
      radius: 0.12,
      material: 'dark',
      explode: [-1.2, -1.8, 0.8],
      flat: [13, 84, 9, 4, 1.5],
    },
    {
      key: 'charging',
      shape: 'box',
      size: [1.3, 0.55, 0.32],
      position: [0.8, -7.05, 0.02],
      radius: 0.12,
      material: 'metal',
      explode: [0.9, -2.6, 0.2],
      flat: [23, 90, 8, 3, 1.2],
    },
    {
      key: 'back_glass',
      shape: 'box',
      size: [6.9, 14.7, 0.1],
      position: [0, 0, -0.44],
      radius: 0.8,
      material: 'body',
      explode: [0, 0, -3.6],
      flat: [58, 8, 32, 84, 6],
    },
    {
      key: 'camera',
      shape: 'box',
      size: [2.9, 2.9, 0.34],
      position: [-1.6, 5.3, -0.62],
      radius: 0.6,
      material: 'dark',
      explode: [-0.9, 0.9, -5.4],
      flat: [60, 10, 13, 13, 3],
    },
    {
      key: 'buttons',
      shape: 'box',
      size: [0.14, 2.8, 0.34],
      position: [3.66, 2.8, 0],
      radius: 0.06,
      material: 'metal',
      explode: [2, 0, 0],
      flat: [44.5, 24, 2.5, 14, 1],
    },
  ],
};

const tablet: DeviceModel = {
  kind: 'tablet',
  camera: { elevation: 0.3, azimuth: -0.5 },
  outlines: [
    [6, 8, 40, 84, 5],
    [54, 8, 40, 84, 5],
  ],
  parts: [
    {
      key: null,
      shape: 'box',
      size: [17.8, 24.8, 0.62],
      position: [0, 0, 0],
      radius: 1,
      material: 'metal',
      explode: [0, 0, 0],
    },
    {
      key: 'screen',
      shape: 'box',
      size: [17.2, 24.2, 0.1],
      position: [0, 0, 0.34],
      radius: 0.9,
      material: 'glass',
      explode: [0, 0, 5],
      flat: [8, 10, 36, 80, 4],
    },
    {
      key: 'board',
      shape: 'box',
      size: [5.6, 12, 0.12],
      position: [5.4, 3.2, 0.1],
      radius: 0.25,
      material: 'board',
      explode: [1.4, 0, 2.6],
      inside: true,
      flat: [70, 14, 20, 30, 2],
    },
    {
      key: 'battery',
      shape: 'box',
      size: [10, 18, 0.3],
      position: [-2.6, -1.2, 0.02],
      radius: 0.4,
      material: 'battery',
      explode: [-0.8, 0, 1.5],
      inside: true,
      flat: [58, 48, 32, 38, 3],
    },
    {
      key: 'speakers',
      shape: 'box',
      size: [3.2, 0.7, 0.3],
      position: [-5.4, -11.9, 0],
      radius: 0.15,
      material: 'dark',
      explode: [0, -2, 0.6],
      flat: [10, 86, 9, 3, 1],
    },
    {
      key: 'charging',
      shape: 'box',
      size: [1.5, 0.6, 0.3],
      position: [0, -12.2, 0],
      radius: 0.15,
      material: 'metal',
      explode: [0, -3.2, 0.2],
      flat: [22, 91, 8, 2.5, 1],
    },
    {
      key: 'camera',
      shape: 'box',
      size: [2.2, 2.2, 0.3],
      position: [-6.9, 10.5, -0.44],
      radius: 0.6,
      material: 'dark',
      explode: [0, 0, -4],
      flat: [57, 11, 9, 9, 2.5],
    },
    {
      key: 'buttons',
      shape: 'box',
      size: [0.14, 3.4, 0.3],
      position: [8.94, 7, 0],
      radius: 0.06,
      material: 'metal',
      explode: [2.4, 0, 0],
      flat: [46.5, 18, 2, 12, 1],
    },
  ],
};

const laptop: DeviceModel = {
  kind: 'laptop',
  camera: { elevation: 0.5, azimuth: -0.6 },
  outlines: [
    [10, 6, 80, 48, 3],
    [6, 56, 88, 40, 3],
  ],
  parts: [
    {
      key: null,
      shape: 'box',
      size: [30.4, 1.4, 21.2],
      position: [0, 0, 0],
      radius: 0.6,
      material: 'metal',
      explode: [0, 0, 0],
    },
    {
      key: 'screen',
      shape: 'box',
      size: [30.4, 20.6, 0.55],
      position: [0, 10.2, -11.2],
      rotation: [-0.2, 0, 0],
      radius: 0.6,
      material: 'glass',
      explode: [0, 5, -4],
      flat: [12, 8, 76, 44, 2],
    },
    {
      key: 'keyboard',
      shape: 'box',
      size: [26.5, 0.2, 10.5],
      position: [0, 0.74, -3.6],
      radius: 0.3,
      material: 'dark',
      explode: [0, 5.4, 0],
      flat: [14, 59, 72, 16, 2],
    },
    {
      key: 'trackpad',
      shape: 'box',
      size: [12.5, 0.12, 7.6],
      position: [0, 0.72, 5.7],
      radius: 0.4,
      material: 'glass',
      explode: [0, 4, 3],
      flat: [36, 78, 28, 10, 2],
    },
    {
      key: 'battery',
      shape: 'box',
      size: [24, 0.5, 7.5],
      position: [0, -0.2, 5.4],
      radius: 0.3,
      material: 'battery',
      explode: [0, -4.6, 1.5],
      inside: true,
      flat: [12, 85, 20, 8, 1.5],
    },
    {
      key: 'board',
      shape: 'box',
      size: [22, 0.3, 7.2],
      position: [0, 0.1, -5.8],
      radius: 0.25,
      material: 'board',
      explode: [0, -3, -2],
      inside: true,
      flat: [68, 85, 20, 8, 1.5],
    },
    {
      key: 'ports',
      shape: 'box',
      size: [0.5, 0.7, 6.2],
      position: [15.1, 0, -2],
      radius: 0.1,
      material: 'metal',
      explode: [3.6, 0, 0],
      flat: [90, 62, 3, 14, 1],
    },
    {
      key: 'speakers',
      shape: 'box',
      size: [2.2, 0.16, 9.6],
      position: [-14.2, 0.72, -3.6],
      radius: 0.1,
      material: 'dark',
      explode: [-3, 3, 0],
      flat: [8, 60, 4, 15, 1],
    },
  ],
};

const watch: DeviceModel = {
  kind: 'watch',
  camera: { elevation: 0.3, azimuth: -0.5 },
  outlines: [
    [18, 4, 16, 92, 4],
    [8, 28, 36, 44, 9],
    [56, 28, 36, 44, 9],
  ],
  parts: [
    {
      key: null,
      shape: 'box',
      size: [2.4, 12, 0.35],
      position: [0, 0, -0.35],
      radius: 0.25,
      material: 'soft',
      explode: [0, 0, -1.4],
    },
    {
      key: null,
      shape: 'box',
      size: [4.1, 4.9, 1.05],
      position: [0, 0, 0],
      radius: 0.9,
      material: 'metal',
      explode: [0, 0, 0],
    },
    {
      key: 'screen',
      shape: 'box',
      size: [3.7, 4.5, 0.12],
      position: [0, 0, 0.58],
      radius: 0.8,
      material: 'glass',
      explode: [0, 0, 2.6],
      flat: [11, 31, 30, 38, 7],
    },
    {
      key: 'board',
      shape: 'box',
      size: [3, 3.2, 0.12],
      position: [0, 0.4, 0.2],
      radius: 0.3,
      material: 'board',
      explode: [0, 0, 1.6],
      inside: true,
      flat: [60, 31, 28, 8, 2],
    },
    {
      key: 'battery',
      shape: 'box',
      size: [3, 2.1, 0.3],
      position: [0, -0.9, 0.05],
      radius: 0.3,
      material: 'battery',
      explode: [0, 0, 0.9],
      inside: true,
      flat: [60, 61, 28, 8, 2],
    },
    {
      key: 'sensors',
      shape: 'cylinder',
      size: [1.4, 0.25, 0],
      position: [0, 0, -0.62],
      rotation: [Math.PI / 2, 0, 0],
      material: 'lens',
      explode: [0, 0, -2.4],
      flat: [66, 42, 16, 16, 8],
    },
    {
      key: 'crown',
      shape: 'cylinder',
      size: [0.32, 0.5, 0],
      position: [2.3, 0.9, 0],
      rotation: [0, 0, Math.PI / 2],
      material: 'metal',
      explode: [1.6, 0, 0],
      flat: [44, 42, 4, 8, 2],
    },
  ],
};

const earbuds: DeviceModel = {
  kind: 'earbuds',
  camera: { elevation: 0.45, azimuth: -0.45 },
  outlines: [],
  parts: [
    {
      key: 'case',
      shape: 'box',
      size: [6.2, 4.8, 2.4],
      position: [0, -1, 0],
      radius: 1.1,
      material: 'body',
      explode: [0, -1.4, 0],
      flat: [20, 50, 60, 38, 10],
    },
    {
      key: 'left_bud',
      shape: 'box',
      size: [1.7, 3.2, 1.6],
      position: [-1.3, 2.4, 0],
      rotation: [0, 0, 0.12],
      radius: 0.75,
      material: 'body',
      explode: [-2.6, 2, 0.6],
      flat: [24, 8, 16, 34, 7],
    },
    {
      key: 'right_bud',
      shape: 'box',
      size: [1.7, 3.2, 1.6],
      position: [1.3, 2.4, 0],
      rotation: [0, 0, -0.12],
      radius: 0.75,
      material: 'body',
      explode: [2.6, 2, 0.6],
      flat: [60, 8, 16, 34, 7],
    },
    {
      key: 'connection',
      shape: 'cylinder',
      size: [0.28, 0.12, 0],
      position: [0, -1.4, 1.24],
      rotation: [Math.PI / 2, 0, 0],
      material: 'lens',
      explode: [0, -0.4, 1.6],
      flat: [45, 76, 10, 6, 3],
    },
  ],
};

const consoleModel: DeviceModel = {
  kind: 'console',
  camera: { elevation: 0.35, azimuth: -0.7 },
  outlines: [[20, 6, 34, 88, 5]],
  parts: [
    {
      key: null,
      shape: 'box',
      size: [9.6, 35.8, 26],
      position: [0, 0, 0],
      radius: 1.2,
      material: 'body',
      explode: [0, 0, 0],
    },
    {
      key: 'disc_drive',
      shape: 'box',
      size: [9.8, 13, 7],
      position: [0.4, -9, 8],
      radius: 0.6,
      material: 'dark',
      explode: [5, 0, 3],
      flat: [23, 58, 28, 24, 3],
    },
    {
      key: 'cooling',
      shape: 'cylinder',
      size: [5.2, 1.6, 0],
      position: [0, 8, -1],
      rotation: [0, 0, Math.PI / 2],
      material: 'dark',
      explode: [6.5, 3, 0],
      inside: true,
      flat: [27, 12, 20, 20, 10],
    },
    {
      key: 'power',
      shape: 'box',
      size: [3, 7, 9],
      position: [0, 3, -8],
      radius: 0.4,
      material: 'board',
      explode: [5.6, 0, -4],
      inside: true,
      flat: [25, 38, 12, 12, 2],
    },
    {
      key: 'hdmi',
      shape: 'box',
      size: [1.2, 1.6, 0.8],
      position: [-4.2, 13, -13.2],
      radius: 0.15,
      material: 'metal',
      explode: [-2.2, 1, -3],
      flat: [42, 40, 9, 6, 1.5],
    },
    {
      key: 'controller',
      shape: 'box',
      size: [15.6, 2.6, 6.6],
      position: [16, -16.4, 12],
      radius: 1.2,
      material: 'soft',
      explode: [4, 0, 4],
      flat: [60, 64, 34, 18, 7],
    },
  ],
};

export const DEVICE_MODELS: Record<ModelKind, DeviceModel> = {
  smartphone: phone,
  tablet,
  laptop,
  watch,
  earbuds,
  console: consoleModel,
};

export function deviceModel(kind: string): DeviceModel | null {
  return kind in DEVICE_MODELS ? DEVICE_MODELS[kind as ModelKind] : null;
}
