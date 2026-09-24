import type * as THREE from "three";
import type { OpenTarget } from "../types";

/** Något klickbart i en 3D-scen (prop, skärm, väggdekor, karaktär). */
export interface Interactive {
  obj: THREE.Object3D;
  label?: string;
  open?: OpenTarget;
  onClick?: () => void;
  /** Riktning kameran ska komma ifrån vid flyTo (t.ex. väggens normal). */
  normal?: THREE.Vector3;
  id?: string;
  /** Förenklad träffyta för raycast (sätts av motorn för GLB:er). */
  hit?: THREE.Object3D;
}
