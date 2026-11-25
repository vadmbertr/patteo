import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { CONFIG_DIR, THEMES_DIR } from "./paths";
import { DEFAULT_THEME, THEMES } from "../theme/themes";
import type { Theme } from "../theme/theme";
import { log } from "../log";

export const SETTINGS_FILE = join(CONFIG_DIR, "config.json");

export type SidebarSize = "narrow" | "normal" | "wide";

export interface Settings {
  theme: string;
  /** Keep the terminal's own (possibly translucent) background. */
  transparent: boolean;
  /** Static indicators instead of animations. */
  reduceMotion: boolean;
  /** Show thoughts in full instead of one line. */
  showThoughts: boolean;
  /** Open finished activity groups by default. */
  expandActivity: boolean;
  sidebar: SidebarSize;
  /** Which side the Files / Changes / PR panel opens on. */
  panelSide: "left" | "right";
  /** Executable on the Paseo host; unset uses its default shell. */
  terminalShell?: string;
  /** Defaults for the New agent form. */
  agentDefaults: { provider?: string; model?: string; modeId?: string };
  /** Command id → key list, overriding the defaults (e.g. { "palette.open": ["ctrl+space"] }). */
  keymap: Record<string, string[]>;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: DEFAULT_THEME,
  transparent: true,
  reduceMotion: false,
  showThoughts: false,
  expandActivity: false,
  sidebar: "normal",
  panelSide: "right",
  agentDefaults: {},
  keymap: {},
};

/** Merges a parsed file onto the defaults, dropping wrong-typed values field by field. */
export function sanitizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const bool = (k: keyof Settings) => (typeof r[k] === "boolean" ? (r[k] as boolean) : (DEFAULT_SETTINGS[k] as boolean));
  const keymap: Record<string, string[]> = {};
  if (r.keymap && typeof r.keymap === "object") {
    for (const [id, keys] of Object.entries(r.keymap as Record<string, unknown>)) {
      if (Array.isArray(keys) && keys.every((k) => typeof k === "string")) keymap[id] = keys as string[];
      else if (typeof keys === "string") keymap[id] = [keys];
    }
  }
  const ad = (r.agentDefaults && typeof r.agentDefaults === "object" ? r.agentDefaults : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  return {
    theme: typeof r.theme === "string" ? r.theme : DEFAULT_SETTINGS.theme,
    transparent: bool("transparent"),
    reduceMotion: bool("reduceMotion"),
    showThoughts: bool("showThoughts"),
    expandActivity: bool("expandActivity"),
    sidebar: r.sidebar === "narrow" || r.sidebar === "wide" ? r.sidebar : "normal",
    panelSide: r.panelSide === "left" ? "left" : "right",
    ...(typeof r.terminalShell === "string" && r.terminalShell.trim() && !r.terminalShell.includes("\0")
      ? { terminalShell: r.terminalShell.trim() } : {}),
    agentDefaults: { provider: str(ad.provider), model: str(ad.model), modeId: str(ad.modeId) },
    keymap,
  };
}

export function loadSettings(file = SETTINGS_FILE): Settings {
  if (!existsSync(file)) return { ...DEFAULT_SETTINGS };
  try {
    return sanitizeSettings(JSON.parse(readFileSync(file, "utf8")));
  } catch (err) {
    log.warn({ err: String(err) }, "ignoring unreadable config.json");
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings, file = SETTINGS_FILE): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file + ".tmp", JSON.stringify(s, null, 2) + "\n");
  renameSync(file + ".tmp", file);
}

/**
 * Custom themes: ~/.config/patteo/themes/<name>.json. Any subset of Theme tokens,
 * merged over the theme named in "extends" (default: catppuccin-mocha).
 */
export function loadCustomThemes(dir = THEMES_DIR): Theme[] {
  if (!existsSync(dir)) return [];
  const out: Theme[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const raw = JSON.parse(readFileSync(join(dir, f), "utf8")) as Partial<Theme> & { extends?: string };
      const base = THEMES.find((t) => t.name === raw.extends) ?? THEMES.find((t) => t.name === DEFAULT_THEME)!;
      const tokens = Object.fromEntries(Object.entries(raw).filter(([k, v]) => k in base && typeof v === "string"));
      out.push({ ...base, ...tokens, name: raw.name || basename(f, ".json") } as Theme);
    } catch (err) {
      log.warn({ file: f, err: String(err) }, "skipping invalid theme");
    }
  }
  return out;
}
