import type { OpenTarget, SiteConfig } from "../types";

export type Sfx = "hover" | "click" | "whoosh" | "pop" | "copy" | "open";

/** Det varje format får av skalet (App). */
export interface FormatProps {
  site: SiteConfig;
  onProgress: (p: number) => void;
  /** Öppna en sektion i skalets panel (eller en länk). */
  onOpen: (t: OpenTarget) => void;
  sfx: (k: Sfx) => void;
}

/** Det skalet kan be ett format om. */
export interface FormatHandle {
  enter: () => void;
  open: (t: OpenTarget) => void;
  closePanel: () => void;
}

/** ownUI = formatet ritar egen navigation/paneler (t.ex. fejk-OS) och skalet visar bara gate + ljudknapp. */
export interface FormatDef {
  load: () => Promise<{ default: React.ForwardRefExoticComponent<FormatProps & React.RefAttributes<FormatHandle>> }>;
  ownUI?: boolean;
}
