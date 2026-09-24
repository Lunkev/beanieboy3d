import type { Format } from "../types";
import type { FormatDef } from "./types";

// Nya format registreras här. Varje format ligger i src/formats/<namn>/ och delar core/ + ui/.
export const FORMATS: Partial<Record<Format, FormatDef>> = {
  room: { load: () => import("./room/RoomView") },
  os: { load: () => import("./os/OsView"), ownUI: true },
  world: { load: () => import("./world/WorldView") },
  toy: { load: () => import("./toy/ToyView") },
  landing: { load: () => import("./landing/LandingView"), ownUI: true },
};
