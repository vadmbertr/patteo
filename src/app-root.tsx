import { useRenderer } from "@opentui/react";
import { useEffect, useLayoutEffect, useMemo } from "react";
import { useStore } from "zustand";
import type { HostConfig, HostsFile } from "./config/hosts";
import { DEFAULT_SETTINGS, loadCustomThemes, loadSettings, type Settings } from "./config/settings";
import { dispatchGlobal, installDispatcher, refreshKeymap } from "./keyboard/dispatch";
import { RuntimeManager } from "./paseo/runtime-manager";
import { AppContext, type AppContextValue } from "./stores/context";
import { loadUiState } from "./stores/persist";
import { createSessionStore } from "./stores/session";
import { createSettingsStore } from "./stores/settings";
import { createUiStore } from "./stores/ui";
import { ThemeContext, withTransparency } from "./theme/theme";
import { findTheme } from "./theme/themes";
import { App } from "./ui/App";
import { composerHandle } from "./ui/agent/Composer";
import { setMotionFrozen } from "./ui/motion/clock";
import { copyForUser, isPasteKey, readClipboard } from "./util/clipboard";
import { watchSelection } from "./ui/clipboard-selection";

export interface AppStateOptions {
  /** Persist settings/state/hosts to ~/.config/patteo (off for tests and scripts). */
  persist?: boolean;
  hostsFile?: HostsFile;
  extraHost?: HostConfig;
  settings?: Partial<Settings>;
}

/** Creates every store and the host runtimes (not started). */
export function createAppState(opts: AppStateOptions = {}): AppContextValue {
  const persist = opts.persist ?? false;
  const base = persist ? loadSettings() : DEFAULT_SETTINGS;
  const settings = createSettingsStore({ ...base, ...opts.settings }, persist ? loadCustomThemes() : [], { persist });
  const store = createSessionStore();
  const ui = createUiStore(persist ? loadUiState() : {});
  const runtimes = new RuntimeManager(store, { hostsFile: opts.hostsFile, extraHost: opts.extraHost, persist });
  return { store, ui, runtimes, settings };
}

/** Theme + transparency + motion from settings, the key dispatcher, and the app. */
export function AppRoot({ state, onQuit }: { state: AppContextValue; onQuit?: () => void }) {
  const renderer = useRenderer();
  const s = useStore(state.settings, (x) => x.settings);
  const custom = useStore(state.settings, (x) => x.customThemes);
  const theme = useMemo(() => withTransparency(findTheme(s.theme, custom), s.transparent), [s.theme, s.transparent, custom]);

  useEffect(() => {
    renderer.setBackgroundColor(s.transparent ? "transparent" : theme.bg);
  }, [theme, s.transparent]);
  useEffect(() => setMotionFrozen(s.reduceMotion), [s.reduceMotion]);
  useEffect(() => {
    installDispatcher({ ...state, quit: onQuit ?? (() => renderer.destroy()) });
  }, []);
  // Global keys live here, not in App: `useLayoutEffect` runs before the children's
  // `useEffect`, so the dispatcher sees a key before the focused view does. Otherwise a
  // view (e.g. the sidebar opening a workspace) could change focus first, and the same
  // key would then run a command meant for the new focus.
  useLayoutEffect(() => {
    const quit = onQuit ?? (() => renderer.destroy());
    const onKey = (k: import("@opentui/core").KeyEvent) => {
      if (k.ctrl && k.name === "c") {
        if (state.ui.getState().modal) return state.ui.actions.closeModal();
        if (state.ui.getState().focus === "terminal") return;
        if (composerHandle.hasText()) return composerHandle.clear();
        return quit();
      }
      // Some terminals forward ⌘V / Ctrl+V as a key instead of pasting (and macOS sends ⌘ as
      // "super"). Paste it ourselves, into the composer when that is where you are typing.
      if (isPasteKey(k) && state.ui.getState().focus === "composer" && !state.ui.getState().modal) {
        k.preventDefault();
        void readClipboard().then((text) => {
          if (text) composerHandle.insert(text);
          else state.ui.actions.toast("The clipboard is empty or not readable here", "info", 2000);
        });
        return;
      }
      if (dispatchGlobal(k)) k.preventDefault();
    };
    renderer.keyInput.on("keypress", onKey);
    return () => {
      renderer.keyInput.off("keypress", onKey);
    };
  }, [renderer]);
  useEffect(() => refreshKeymap(), [s.keymap]);

  // Selecting text with the mouse copies it, the way a terminal emulator does. The native
  // clipboard covers Terminal.app; OSC 52 covers SSH sessions.
  useEffect(
    () =>
      watchSelection(
        renderer as unknown as Parameters<typeof watchSelection>[0],
        (text) => copyForUser(text, (t) => renderer.copyToClipboardOSC52(t)),
        (message) => state.ui.actions.toast(message, "info", 1400),
      ),
    [renderer],
  );

  return (
    <ThemeContext.Provider value={theme}>
      <AppContext.Provider value={state}>
        <App />
      </AppContext.Provider>
    </ThemeContext.Provider>
  );
}
