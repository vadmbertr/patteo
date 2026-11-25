import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testRender } from "@opentui/react/test-utils";
import { DEFAULT_SETTINGS, loadCustomThemes, sanitizeSettings } from "../src/config/settings";
import { installDispatcher, dispatchGlobal, viewShouldIgnore } from "../src/keyboard/dispatch";
import { resolveCommands } from "../src/keyboard/commands";
import { createSessionStore } from "../src/stores/session";
import { AppContext } from "../src/stores/context";
import { createSettingsStore } from "../src/stores/settings";
import { createUiStore } from "../src/stores/ui";
import { findTheme, THEMES } from "../src/theme/themes";
import { parseHostAddress } from "../src/ui/modals/HostsModals";
import { usableProviders } from "../src/ui/modals/NewAgentModal";
import { AppRoot, createAppState } from "../src/app-root";

const key = (name: string, o: Partial<{ ctrl: boolean; shift: boolean; meta: boolean; sequence: string }> = {}) => ({ name, ctrl: false, meta: false, shift: false, sequence: name, ...o });

function dispatcherWith(focus: "sidebar" | "main" | "composer") {
  const ui = createUiStore();
  ui.actions.setFocus(focus);
  let quit = 0;
  installDispatcher({ ui, store: createSessionStore(), runtimes: {} as never, settings: createSettingsStore(DEFAULT_SETTINGS, [], { persist: false }), quit: () => quit++ });
  return { ui, quits: () => quit };
}

describe("keyboard routing", () => {
  test("q quits from the sidebar but is plain text in the composer", () => {
    const a = dispatcherWith("sidebar");
    expect(dispatchGlobal(key("q"))).toBe(true);
    expect(a.quits()).toBe(1);
    const b = dispatcherWith("composer");
    expect(dispatchGlobal(key("q"))).toBe(false);
    expect(b.quits()).toBe(0);
  });

  test("typing letters never opens a dialog: bare keys stay in the composer", () => {
    // n is bound to "New agent" (also ctrl+o); typing it must not open the dialog,
    // and neither must a user remap that reuses a single letter.
    const store = createSessionStore();
    store.actions.addHost({ id: "h", label: "h", url: "ws://x/ws" });
    store.actions.setActiveHost("h");
    store.actions.setWorkspaces("h", [{ id: "w", projectId: "p", title: "W", status: "idle" } as never]);
    const ui = createUiStore();
    ui.actions.selectWorkspace("h", "w");
    ui.actions.setFocus("composer");
    installDispatcher({ ui, store, runtimes: {} as never, settings: createSettingsStore(DEFAULT_SETTINGS, [], { persist: false }), quit: () => {} });
    expect(dispatchGlobal(key("n"))).toBe(false);
    expect(ui.getState().modal).toBeNull();
    expect(viewShouldIgnore(key("n"))).toBe(false); // the text field owns it
    expect(dispatchGlobal(key("o", { ctrl: true }))).toBe(true);
    expect(ui.getState().modal).toEqual({ kind: "newAgent" });
  });

  test("modifier commands still work in the composer; modals swallow everything", () => {
    const c = dispatcherWith("composer");
    expect(dispatchGlobal(key("k", { ctrl: true }))).toBe(true);
    expect(c.ui.getState().modal).toEqual({ kind: "palette" });
    expect(dispatchGlobal(key("q"))).toBe(false);
    expect(viewShouldIgnore(key("j"))).toBe(true);
  });

  test("views ignore keys a global command claims", () => {
    dispatcherWith("sidebar");
    expect(viewShouldIgnore(key("h", { shift: true }))).toBe(true); // H = hosts
    expect(viewShouldIgnore(key("h"))).toBe(false); // h = fold in the sidebar
  });

  test("keymap overrides replace default keys", () => {
    const cmds = resolveCommands({ "palette.open": ["ctrl+space"] });
    expect(cmds.find((c) => c.id === "palette.open")!.keys).toEqual(["ctrl+space"]);
  });
});

describe("settings and themes", () => {
  test("sanitizeSettings keeps valid fields and drops junk", () => {
    const s = sanitizeSettings({ theme: "nord", transparent: "yes", sidebar: "huge", keymap: { "app.quit": "ctrl+q", bad: 3 }, agentDefaults: { provider: "claude", model: 7 } });
    expect(s.theme).toBe("nord");
    expect(s.transparent).toBe(DEFAULT_SETTINGS.transparent);
    expect(s.sidebar).toBe("normal");
    expect(s.keymap).toEqual({ "app.quit": ["ctrl+q"] });
    expect(s.agentDefaults).toEqual({ provider: "claude", model: undefined, modeId: undefined });
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  test("every built-in theme defines every token", () => {
    const keys = Object.keys(THEMES[0]!);
    for (const th of THEMES) for (const k of keys) expect(typeof (th as unknown as Record<string, unknown>)[k]).not.toBe("undefined");
    expect(new Set(THEMES.map((t) => t.name)).size).toBe(THEMES.length);
    expect(findTheme("nope").name).toBe("catppuccin-mocha");
  });

  test("custom themes extend a base theme", () => {
    const dir = mkdtempSync(join(tmpdir(), "patteo-themes-"));
    writeFileSync(join(dir, "mine.json"), JSON.stringify({ extends: "nord", accent: "#ff00ff" }));
    writeFileSync(join(dir, "broken.json"), "{");
    const [mine] = loadCustomThemes(dir);
    expect(mine!.name).toBe("mine");
    expect(mine!.accent).toBe("#ff00ff");
    expect(mine!.bg).toBe(findTheme("nord").bg);
  });
});

describe("forms", () => {
  test("host addresses", () => {
    expect(parseHostAddress("10.0.0.5:6767")).toEqual({ url: "ws://10.0.0.5:6767/ws" });
    expect("error" in parseHostAddress("ssh://box")).toBe(true);
    expect("error" in parseHostAddress("")).toBe(true);
  });

  test("only enabled, ready providers are offered", () => {
    const list = usableProviders({ entries: [{ provider: "claude", status: "ready", enabled: true, modes: [{ id: "plan", label: "Plan" }] }, { provider: "x", enabled: false }, { provider: "y", status: "error" }] });
    expect(list.map((p) => p.provider)).toEqual(["claude"]);
    expect(list[0]!.modes).toEqual([{ id: "plan", label: "Plan" }]);
  });
});

describe("AppRoot", () => {
  test("changing the theme setting recolors the UI live", async () => {
    const origError = console.error;
    console.error = () => {};
    try {
      const state = createAppState({ hostsFile: { defaultHostId: "h", hosts: [{ id: "h", label: "h", url: "ws://127.0.0.1:1/ws" }] }, settings: { transparent: false } });
      const t = await testRender(<AppRoot state={state} onQuit={() => {}} />, { width: 80, height: 16 });
      await t.renderOnce();
      const accentOf = () => {
        const f = t.captureSpans() as unknown as { lines: { spans: { text: string; fg: { buffer: ArrayLike<number> } }[] }[] };
        const span = f.lines[0]!.spans.find((s) => s.text.includes("Workspaces"))!;
        return Array.from(span.fg.buffer).slice(0, 3).map((v) => Math.round(v * 255));
      };
      const before = accentOf();
      state.settings.actions.update({ theme: "gruvbox-dark" });
      await Bun.sleep(20);
      await t.renderOnce();
      expect(accentOf()).not.toEqual(before);
      t.renderer.destroy();
      await state.runtimes.disposeAll();
    } finally {
      console.error = origError;
    }
  });
});

import { PermissionsModal } from "../src/ui/modals/PermissionsModal";

test("permissions dialog shows the request and its actions", async () => {
  const origError = console.error;
  console.error = () => {};
  try {
    const state = createAppState({ hostsFile: { defaultHostId: "h", hosts: [{ id: "h", label: "h", url: "ws://127.0.0.1:1/ws" }] } });
    state.store.actions.addHost({ id: "h", label: "h", url: "ws://127.0.0.1:1/ws" });
    state.store.actions.setAgents("h", [{
      id: "a1", title: "Fix tests", status: "running", workspaceId: "w", updatedAt: new Date().toISOString(),
      pendingPermissions: [{ id: "p1", provider: "claude", name: "Bash", kind: "tool", title: "Run a shell command", detail: { type: "shell", command: "rm -rf build" } }],
    } as never]);
    const t = await testRender(
      <AppContext.Provider value={state}>
        <PermissionsModal />
      </AppContext.Provider>,
      { width: 90, height: 24 },
    );
    await t.renderOnce();
    const f = t.captureCharFrame();
    for (const s of ["Permission 1/1", "from Fix tests", "Run a shell command", "$ rm -rf build", "y Allow", "n Deny"]) expect(f).toContain(s);
    t.renderer.destroy();
    await state.runtimes.disposeAll();
  } finally {
    console.error = origError;
  }
});

import { SLASH_COMMANDS, resolveSlash, slashCompletion, slashMatches, slashQuery } from "../src/ui/agent/slash";

describe("slash commands", () => {
  test("only a leading / without arguments is a query", () => {
    expect(slashQuery("/fo")).toBe("fo");
    expect(slashQuery("  /fork")).toBe("fork");
    expect(slashQuery("/fork now")).toBeNull();
    expect(slashQuery("fork")).toBeNull();
    expect(slashQuery("")).toBeNull();
  });

  test("prefixes filter; exact names and unique prefixes resolve", () => {
    expect(slashMatches("/", SLASH_COMMANDS).map((c) => c.name)).toEqual(SLASH_COMMANDS.map((c) => c.name));
    expect(slashMatches("/for", SLASH_COMMANDS).map((c) => c.name)).toEqual(["fork"]);
    expect(slashMatches("/m", SLASH_COMMANDS).map((c) => c.name)).toEqual(["model", "mode"]);
    expect(resolveSlash("/fork", SLASH_COMMANDS)?.name).toBe("fork");
    expect(resolveSlash("/fo", SLASH_COMMANDS)?.name).toBe("fork");
    expect(resolveSlash("/m", SLASH_COMMANDS)).toBeNull(); // model or mode: ambiguous
    expect(resolveSlash("/fork please", SLASH_COMMANDS)).toBeNull();
    expect(resolveSlash("/nope", SLASH_COMMANDS)).toBeNull();
  });
});

describe("composer focus keys", () => {
  function withAgent(focus: "main" | "sidebar" | "composer") {
    const store = createSessionStore();
    store.actions.addHost({ id: "h", label: "h", url: "ws://x/ws" });
    store.actions.setActiveHost("h");
    store.actions.setWorkspaces("h", [{ id: "w", projectId: "p", title: "W", status: "idle" } as never]);
    store.actions.setAgents("h", [{ id: "a", status: "idle", cwd: "/r", workspaceId: "w", updatedAt: new Date().toISOString(), provider: "claude", model: "claude-haiku" } as never]);
    const ui = createUiStore();
    ui.actions.selectWorkspace("h", "w");
    ui.actions.updateTabs("h:w", (s) => ({ ...s, tabs: ["a"], active: "a" }));
    ui.actions.setFocus(focus);
    installDispatcher({ ui, store, runtimes: {} as never, settings: createSettingsStore(DEFAULT_SETTINGS, [], { persist: false }), quit: () => {} });
    return ui;
  }

  test("Enter writes from the conversation, but opens a workspace in the sidebar", async () => {
    const main = withAgent("main");
    expect(dispatchGlobal(key("return"))).toBe(true);
    await Bun.sleep(5); // focus lands after the key event, so it can't type itself
    expect(main.getState().focus).toBe("composer");

    const side = withAgent("sidebar");
    expect(dispatchGlobal(key("return"))).toBe(false);
    expect(side.getState().focus).toBe("sidebar");
  });

  test("Enter is never claimed while typing (it submits the text field)", () => {
    const ui = withAgent("composer");
    expect(dispatchGlobal(key("return"))).toBe(false);
    expect(viewShouldIgnore(key("return"))).toBe(false);
    expect(ui.getState().focus).toBe("composer");
  });
});

describe("settings modal", () => {
  async function open(width = 150) {
    const state = createAppState({ hostsFile: { defaultHostId: "h", hosts: [{ id: "h", label: "h", url: "ws://127.0.0.1:1/ws" }] }, settings: { transparent: false } });
    const t = await testRender(<AppRoot state={state} onQuit={() => {}} />, { width, height: 26 });
    await t.renderOnce();
    state.ui.actions.openModal({ kind: "settings" });
    await Bun.sleep(20);
    await t.renderOnce();
    return { t, state };
  }

  test("Esc steps back out of a section before it closes the dialog", async () => {
    const origError = console.error;
    console.error = () => {};
    try {
      const { t, state } = await open();
      t.mockInput.pressEnter(); // open the first section
      await Bun.sleep(20);
      await t.renderOnce();
      t.mockInput.pressEscape(); // back to the section list
      await Bun.sleep(20);
      await t.renderOnce();
      expect(state.ui.getState().modal).toEqual({ kind: "settings" });
      t.mockInput.pressEscape(); // now close
      await Bun.sleep(20);
      await t.renderOnce();
      expect(state.ui.getState().modal).toBeNull();
      t.renderer.destroy();
      await state.runtimes.disposeAll();
    } finally {
      console.error = origError;
    }
  });

  test("rows keep their columns: labels and values are not wrapped or squeezed", async () => {
    const origError = console.error;
    console.error = () => {};
    try {
      const { t, state } = await open(150);
      const frame = t.captureCharFrame();
      expect(frame).toContain("Transparent background");
      expect(frame).toContain("Sidebar width");
      expect(frame).toContain("keep your terminal's own background");
      // No row may spill past the dialog's 96-column panel.
      const widest = Math.max(...frame.split("\n").map((l) => [...l].length));
      expect(widest).toBeLessThanOrEqual(150);
      state.ui.actions.closeModal();
      t.renderer.destroy();
      await state.runtimes.disposeAll();
    } finally {
      console.error = origError;
    }
  });
});

import { WorkspacePane } from "../src/ui/workspace/WorkspacePane";

describe("conversation escape", () => {
  test("Esc stops the running turn instead of leaving the pane", async () => {
    const origError = console.error;
    console.error = () => {};
    try {
      const store = createSessionStore();
      store.actions.addHost({ id: "h", label: "h", url: "ws://x/ws" });
      store.actions.setActiveHost("h");
      store.actions.setWorkspaces("h", [{ id: "w", projectId: "p", title: "W", status: "idle" } as never]);
      store.actions.setAgents("h", [{ id: "a", status: "running", cwd: "/r", workspaceId: "w", updatedAt: new Date().toISOString(), provider: "claude", model: "m", title: "A" } as never]);
      const ui = createUiStore();
      ui.actions.selectWorkspace("h", "w");
      ui.actions.updateTabs("h:w", (s) => ({ ...s, tabs: ["a"], active: "a" }));
      ui.actions.setFocus("main");
      const cancelled: string[] = [];
      const runtimes = {
        get: () => ({
          openTimeline: () => () => {},
          loadOlder: async () => {},
          cancel: async (id: string) => { cancelled.push(id); },
        }),
        setDefaultHost: () => {},
      } as never;
      const settings = createSettingsStore(DEFAULT_SETTINGS, [], { persist: false });
      // The app installs the dispatcher once; the pane consults it before handling keys.
      installDispatcher({ ui, store, runtimes, settings, quit: () => {} });
      const t = await testRender(
        <AppContext.Provider value={{ store, ui, runtimes, settings }}>
          <box width={90} height={24}><WorkspacePane width={90} height={24} /></box>
        </AppContext.Provider>,
        { width: 90, height: 24 },
      );
      await t.renderOnce();
      t.mockInput.pressEscape();
      await Bun.sleep(20);
      await t.renderOnce();
      expect(cancelled).toEqual(["a"]);
      expect(ui.getState().focus).toBe("main"); // the pane did not change
      t.renderer.destroy();
    } finally {
      console.error = origError;
    }
  });
});

import { Composer } from "../src/ui/agent/Composer";

describe("composer slash commands", () => {
  test("/fork forks the conversation and opens the new agent in a tab", async () => {
    const origError = console.error;
    console.error = () => {};
    try {
      const store = createSessionStore();
      store.actions.addHost({ id: "h", label: "h", url: "ws://x/ws" });
      store.actions.setActiveHost("h");
      store.actions.setWorkspaces("h", [{ id: "w", projectId: "p", title: "W", status: "idle" } as never]);
      store.actions.setAgents("h", [{ id: "a", status: "idle", cwd: "/r", workspaceId: "w", updatedAt: new Date().toISOString(), provider: "claude", model: "m", title: "A" } as never]);
      const ui = createUiStore();
      ui.actions.selectWorkspace("h", "w");
      ui.actions.updateTabs("h:w", (s) => ({ ...s, tabs: ["a"], active: "a" }));
      ui.actions.setFocus("composer");
      let forked = 0;
      const runtimes = { get: () => ({ fork: async () => { forked++; return "a2"; }, send: async () => {} }) } as never;
      const settings = createSettingsStore(DEFAULT_SETTINGS, [], { persist: false });
      const t = await testRender(
        <AppContext.Provider value={{ store, ui, runtimes, settings }}>
          <box width={80} height={20}><Composer hostId="h" agentId="a" width={80} /></box>
        </AppContext.Provider>,
        { width: 80, height: 20 },
      );
      await t.renderOnce();
      for (const ch of "/fork") t.mockInput.pressKey(ch);
      await Bun.sleep(20);
      await t.renderOnce();
      t.mockInput.pressEnter();
      await Bun.sleep(30);
      await t.renderOnce();
      expect(forked).toBe(1);
      expect(ui.getState().tabs["h:w"]?.tabs).toEqual(["a", "a2"]);
      expect(t.captureCharFrame()).not.toContain("/fork");
      t.renderer.destroy();
    } finally {
      console.error = origError;
    }
  });

  test("letters type into the box and Esc gives the conversation back", async () => {
    const origError = console.error;
    console.error = () => {};
    try {
      const store = createSessionStore();
      store.actions.addHost({ id: "h", label: "h", url: "ws://x/ws" });
      store.actions.setActiveHost("h");
      store.actions.setWorkspaces("h", [{ id: "w", projectId: "p", title: "W", status: "idle" } as never]);
      store.actions.setAgents("h", [{ id: "a", status: "idle", cwd: "/r", workspaceId: "w", updatedAt: new Date().toISOString(), provider: "claude", model: "m", title: "A" } as never]);
      const ui = createUiStore();
      ui.actions.selectWorkspace("h", "w");
      ui.actions.updateTabs("h:w", (s) => ({ ...s, tabs: ["a"], active: "a" }));
      ui.actions.setFocus("composer");
      const settings = createSettingsStore(DEFAULT_SETTINGS, [], { persist: false });
      const runtimes = { get: () => ({ send: async () => {} }) } as never;
      const t = await testRender(
        <AppContext.Provider value={{ store, ui, runtimes, settings }}>
          <box width={80} height={20}><Composer hostId="h" agentId="a" width={80} /></box>
        </AppContext.Provider>,
        { width: 80, height: 20 },
      );
      await t.renderOnce();
      for (const ch of "nq") t.mockInput.pressKey(ch);
      await Bun.sleep(20);
      await t.renderOnce();
      expect(ui.getState().drafts["h:a"]).toBe("nq");
      expect(ui.getState().modal).toBeNull(); // n did not open "New agent"
      t.mockInput.pressEscape();
      await Bun.sleep(20);
      await t.renderOnce();
      expect(ui.getState().focus).toBe("main");
      t.renderer.destroy();
    } finally {
      console.error = origError;
    }
  });
});
import { AddFolderModal, normalizeFolderPath } from "../src/ui/modals/AddFolderModal";
import { NewAgentModal, agentTarget } from "../src/ui/modals/NewAgentModal";

describe("add folder", () => {
  test("paths expand ~, lose quotes and trailing slashes, and must be absolute", () => {
    expect(normalizeFolderPath("~/Lab/x", "/Users/me")).toEqual({ path: "/Users/me/Lab/x" });
    expect(normalizeFolderPath("~", "/Users/me")).toEqual({ path: "/Users/me" });
    expect(normalizeFolderPath('  "/tmp/a b/"  ')).toEqual({ path: "/tmp/a b" });
    expect(normalizeFolderPath("/")).toEqual({ path: "/" });
    expect("error" in normalizeFolderPath("Lab/x")).toBe(true);
    expect("error" in normalizeFolderPath("   ")).toBe(true);
  });

  async function openModal() {
    const store = createSessionStore();
    store.actions.addHost({ id: "h", label: "h", url: "ws://x/ws" });
    store.actions.setActiveHost("h");
    const ui = createUiStore();
    ui.actions.setFocus("main");
    const calls: { path: string; create: boolean }[] = [];
    const runtimes = {
      get: () => ({ openFolder: async (path: string, create: boolean) => { calls.push({ path, create }); return { id: "w-new" }; } }),
    } as never;
    const settings = createSettingsStore(DEFAULT_SETTINGS, [], { persist: false });
    const t = await testRender(
      <AppContext.Provider value={{ store, ui, runtimes, settings }}>
        <box width={90} height={20}><AddFolderModal /></box>
      </AppContext.Provider>,
      { width: 90, height: 20 },
    );
    await t.renderOnce();
    return { t, ui, calls };
  }

  test("Enter opens the folder and selects the new workspace", async () => {
    const origError = console.error;
    console.error = () => {};
    try {
      const { t, ui, calls } = await openModal();
      for (const ch of "/tmp/patteo-new") t.mockInput.pressKey(ch);
      await Bun.sleep(20);
      await t.renderOnce();
      t.mockInput.pressEnter();
      await Bun.sleep(30);
      await t.renderOnce();
      expect(calls).toEqual([{ path: "/tmp/patteo-new", create: false }]);
      expect(ui.getState().selectedWorkspace.h).toBe("w-new");
      t.renderer.destroy();
    } finally {
      console.error = origError;
    }
  });

  test("^G creates the folder when it is missing", async () => {
    const origError = console.error;
    console.error = () => {};
    try {
      const { t, calls } = await openModal();
      for (const ch of "/tmp/brand-new") t.mockInput.pressKey(ch);
      await Bun.sleep(20);
      await t.renderOnce();
      t.mockInput.pressKey("g", { ctrl: true });
      await Bun.sleep(30);
      await t.renderOnce();
      expect(calls).toEqual([{ path: "/tmp/brand-new", create: true }]);
      t.renderer.destroy();
    } finally {
      console.error = origError;
    }
  });
});

import { completeFolder, splitFolderInput } from "../src/ui/modals/folder-complete";
import { longestCommonPrefix } from "../src/util/text";
import { homedir } from "node:os";

describe("folder completion", () => {
  test("splits the path and keeps ~ whole", () => {
    expect(splitFolderInput("/tmp/ab")).toEqual({ dir: "/tmp/", prefix: "ab" });
    expect(splitFolderInput("/tmp/")).toEqual({ dir: "/tmp/", prefix: "" });
    expect(splitFolderInput("~")).toEqual({ dir: "~/", prefix: "" });
    expect(splitFolderInput("x")).toEqual({ dir: "", prefix: "x" });
    expect(longestCommonPrefix(["alpha", "alpine", "alps"])).toBe("alp");
  });

  test("one match fills in, several extend to the common prefix, dot dirs stay hidden", () => {
    const home = "/Users/me";
    expect(completeFolder("/tmp/al", ["alpha", "beta"], home)).toMatchObject({ value: "/tmp/alpha/", candidates: ["alpha"] });
    expect(completeFolder("/tmp/al", ["alpha", "alpine"], home).value).toBe("/tmp/alp");
    expect(completeFolder("/tmp/", [".git", "src"], home).candidates).toEqual(["src"]);
    expect(completeFolder("/tmp/.", [".git", "src"], home).candidates).toEqual([".git"]);
    expect(completeFolder("~/La", ["Lab"], home)).toMatchObject({ value: "~/Lab/", listDir: `${home}/` });
    expect(completeFolder("/tmp/zz", ["alpha"], home).value).toBe("/tmp/zz");
  });

  async function openModal(entries: string[]) {
    const store = createSessionStore();
    store.actions.addHost({ id: "h", label: "h", url: "ws://x/ws" });
    store.actions.setActiveHost("h");
    const ui = createUiStore();
    const calls: { path: string; create: boolean }[] = [];
    const listed: string[] = [];
    const runtimes = {
      get: () => ({
        listDirs: async (p: string) => { listed.push(p); return entries; },
        openFolder: async (path: string, create: boolean) => { calls.push({ path, create }); return { id: "w-new" }; },
      }),
    } as never;
    const settings = createSettingsStore(DEFAULT_SETTINGS, [], { persist: false });
    const t = await testRender(
      <AppContext.Provider value={{ store, ui, runtimes, settings }}>
        <box width={90} height={24}><AddFolderModal /></box>
      </AppContext.Provider>,
      { width: 90, height: 24 },
    );
    await t.renderOnce();
    return { t, ui, calls, listed };
  }

  test("Tab completes against the daemon's listing and Enter opens the completed path", async () => {
    const origError = console.error;
    console.error = () => {};
    try {
      const { t, calls, listed } = await openModal(["alpha", "beta"]);
      for (const ch of "/tmp/al") t.mockInput.pressKey(ch);
      await Bun.sleep(20);
      await t.renderOnce();
      t.mockInput.pressTab();
      await Bun.sleep(30);
      await t.renderOnce();
      expect(listed).toEqual(["/tmp/"]);
      const frame = t.captureCharFrame();
      expect(frame).toContain("/tmp/alpha/");
      t.mockInput.pressEnter();
      await Bun.sleep(30);
      await t.renderOnce();
      expect(calls).toEqual([{ path: "/tmp/alpha", create: false }]);
      t.renderer.destroy();
    } finally {
      console.error = origError;
    }
  });

  test("Tab expands ~ before asking the daemon", async () => {
    const origError = console.error;
    console.error = () => {};
    try {
      const { t, listed } = await openModal(["Lab"]);
      for (const ch of "~/L") t.mockInput.pressKey(ch);
      await Bun.sleep(20);
      await t.renderOnce();
      t.mockInput.pressTab();
      await Bun.sleep(30);
      await t.renderOnce();
      expect(listed).toEqual([`${homedir()}/`]);
      expect(t.captureCharFrame()).toContain("~/Lab/");
      t.renderer.destroy();
    } finally {
      console.error = origError;
    }
  });
});

import { toDiffFiles, toPrState, emptyChanges } from "../src/paseo/changes";
import { changesKey } from "../src/stores/session";
import { fileGlyph, fileLabel, prBadge, summarize } from "../src/ui/changes/model";

const diffFile = (path: string, over: Partial<{ isNew: boolean; isDeleted: boolean; oldPath: string; additions: number; deletions: number }> = {}) => ({
  path,
  isNew: false,
  isDeleted: false,
  additions: 2,
  deletions: 1,
  hunks: [{ oldStart: 1, oldCount: 2, newStart: 1, newCount: 3, lines: [{ type: "context", content: "keep" }, { type: "remove", content: "old line" }, { type: "add", content: "new line" }] }],
  ...over,
});

describe("changes model", () => {
  test("status letters, labels and totals", () => {
    expect(fileGlyph(diffFile("a.ts") as never)).toBe("M");
    expect(fileGlyph(diffFile("a.ts", { isNew: true }) as never)).toBe("A");
    expect(fileGlyph(diffFile("a.ts", { isDeleted: true }) as never)).toBe("D");
    expect(fileGlyph(diffFile("b/a.ts", { oldPath: "b/old.ts" }) as never)).toBe("R");
    expect(fileLabel(diffFile("src/ui/a.ts") as never)).toEqual({ name: "a.ts", dir: "src/ui" });
    expect(fileLabel(diffFile("README.md") as never)).toEqual({ name: "README.md", dir: "" });
    expect(summarize([diffFile("a"), diffFile("b", { additions: 5, deletions: 0 })] as never)).toEqual({ files: 2, additions: 7, deletions: 1 });
  });

  test("PR badge: none, open, failing checks, merged", () => {
    const base = emptyChanges();
    expect(prBadge(base)).toEqual({ text: "P  create PR", tone: "muted" });
    expect(prBadge({ ...base, prLoading: true }).text).toContain("checking");
    expect(prBadge({ ...base, pr: { url: "u", state: "OPEN", number: 12, checks: [] } })).toEqual({ text: "#12 open", tone: "ok" });
    expect(prBadge({ ...base, pr: { url: "u", state: "OPEN", number: 12, checksStatus: "FAILURE", checks: [] } })).toEqual({ text: "#12 open · checks failure", tone: "err" });
    expect(prBadge({ ...base, pr: { url: "u", state: "MERGED", number: 9, checks: [] } })).toEqual({ text: "#9 merged", tone: "ok" });
  });

  test("daemon payload maps to files, including binary and unknown lines", () => {
    const mapped = toDiffFiles({
      files: [{ path: "x.png", additions: 0, deletions: 0, status: "binary" }, { path: "y.ts", additions: 1, deletions: 2, hunks: [{ oldStart: 1, oldCount: 1, newStart: 1, newCount: 1, lines: [{ type: "weird", content: "z" }] }] }],
      error: { message: "not a repo" },
      diffTooLarge: true,
    });
    expect(mapped.error).toBe("not a repo");
    expect(mapped.diffTooLarge).toBe(true);
    expect(mapped.files[0]).toMatchObject({ path: "x.png", status: "binary" });
    expect(mapped.files[1]!.hunks[0]!.lines[0]).toEqual({ type: "context", content: "z" });
    expect(toPrState({ status: { url: "https://forge/pr/1", state: "OPEN", number: 1 } })).toMatchObject({ number: 1, state: "OPEN" });
    expect(toPrState({ status: null })).toBeNull();
  });
});

describe("key order", () => {
  test("Enter in the sidebar opens a workspace; it does not leak into the composer", async () => {
    const origError = console.error;
    console.error = () => {};
    try {
      const state = createAppState({ hostsFile: { defaultHostId: "h", hosts: [{ id: "h", label: "h", url: "ws://127.0.0.1:1/ws" }] } });
      state.store.actions.addHost({ id: "h", label: "h", url: "ws://127.0.0.1:1/ws" });
      state.store.actions.setActiveHost("h");
      state.store.actions.setProjects("h", [{ projectId: "p", projectDisplayName: "Proj", projectRootPath: "/r", projectKind: "git" } as never]);
      state.store.actions.setWorkspaces("h", [{ id: "w", projectId: "p", title: "W", workspaceDirectory: "/r", workspaceKind: "checkout", workspaceStatus: "idle", projectRootPath: "/r", projectDisplayName: "Proj", projectKind: "git" } as never]);
      state.store.actions.setAgents("h", [{ id: "a", workspaceId: "w", status: "idle", cwd: "/r", updatedAt: new Date().toISOString(), provider: "claude", model: "m", title: "A", activeTurn: null } as never]);
      state.ui.actions.setCursor("h:ws:w");

      const t = await testRender(<AppRoot state={state} onQuit={() => {}} />, { width: 100, height: 20 });
      for (let i = 0; i < 20; i++) {
        await Bun.sleep(15);
        await t.renderOnce();
      }
      t.mockInput.pressEnter(); // sidebar → open the workspace
      await Bun.sleep(30);
      await t.renderOnce();
      expect(state.ui.getState().focus).toBe("main");

      t.mockInput.pressEnter(); // main → write a message (the intended behavior)
      await Bun.sleep(30);
      await t.renderOnce();
      expect(state.ui.getState().focus).toBe("composer");
      t.renderer.destroy();
      await state.runtimes.disposeAll();
    } finally {
      console.error = origError;
    }
  });
});

import { composerHeight, composerLineCount, maxComposerLines } from "../src/ui/agent/composer-size";
import { RuntimeManager } from "../src/paseo/runtime-manager";
import { EditHostModal } from "../src/ui/modals/HostsModals";

describe("composer sizing", () => {
  test("wraps into rows and stops at half the body", () => {
    expect(composerLineCount("one", 20)).toBe(1);
    expect(composerLineCount("a\nb\nc", 20)).toBe(3);
    expect(composerLineCount("x".repeat(45), 20)).toBe(3); // ceil(45/20)
    expect(composerLineCount("", 20)).toBe(1);
    expect(maxComposerLines(40)).toBe(20);
    expect(maxComposerLines(24)).toBe(12);
    expect(maxComposerLines(8)).toBe(6);
    expect(maxComposerLines(0)).toBe(8);
    expect(composerHeight(3, 12)).toBe(6); // 3 rows + border + status
    expect(composerHeight(40, 12)).toBe(15); // clamped
  });
});

describe("hosts management", () => {
  test("rename updates hosts.json and the live host", async () => {
    const store = createSessionStore();
    const file = { defaultHostId: "a", hosts: [{ id: "a", label: "A", url: "ws://127.0.0.1:1/ws" }] };
    const mgr = new RuntimeManager(store, { hostsFile: structuredClone(file) });
    mgr.start();
    mgr.renameHost("a", "  Workstation  ");
    expect(mgr.hosts()[0]!.label).toBe("Workstation");
    expect(store.getState().hosts.a!.config.label).toBe("Workstation");
    mgr.renameHost("a", "   "); // blank keeps the URL as the label
    expect(mgr.hosts()[0]!.label).toBe("ws://127.0.0.1:1/ws");
    await mgr.disposeAll();
  });

  test("rename modal saves through the runtime and closes", async () => {
    const origError = console.error;
    console.error = () => {};
    try {
      const store = createSessionStore();
      const ui = createUiStore();
      ui.actions.openModal({ kind: "editHost", id: "h", label: "Old" });
      const renamed: { id: string; label: string }[] = [];
      const runtimes = { renameHost: (id: string, label: string) => { renamed.push({ id, label }); } } as never;
      const settings = createSettingsStore(DEFAULT_SETTINGS, [], { persist: false });
      const t = await testRender(
        <AppContext.Provider value={{ store, ui, runtimes, settings }}>
          <box width={70} height={12}><EditHostModal hostId="h" label="Old" /></box>
        </AppContext.Provider>,
        { width: 70, height: 12 },
      );
      await t.renderOnce();
      for (const ch of "New") t.mockInput.pressKey(ch);
      await Bun.sleep(20);
      await t.renderOnce();
      // The current name is selected on open, so typing replaces it.
      t.mockInput.pressEnter();
      await Bun.sleep(20);
      await t.renderOnce();
      expect(renamed).toEqual([{ id: "h", label: "New" }]);
      expect(ui.getState().modal).toBeNull();
      t.renderer.destroy();
    } finally {
      console.error = origError;
    }
  });
});

describe("composer newlines", () => {
  test("shift+Enter adds a line; only plain Enter sends", async () => {
    const origError = console.error;
    console.error = () => {};
    try {
      const store = createSessionStore();
      store.actions.addHost({ id: "h", label: "h", url: "ws://x/ws" });
      store.actions.setActiveHost("h");
      store.actions.setWorkspaces("h", [{ id: "w", projectId: "p", title: "W", status: "idle" } as never]);
      store.actions.setAgents("h", [{ id: "a", status: "idle", cwd: "/r", workspaceId: "w", updatedAt: new Date().toISOString(), provider: "claude", model: "m", title: "A" } as never]);
      const ui = createUiStore();
      ui.actions.selectWorkspace("h", "w");
      ui.actions.updateTabs("h:w", (s) => ({ ...s, tabs: ["a"], active: "a" }));
      ui.actions.setFocus("composer");
      const sent: string[] = [];
      const runtimes = { get: () => ({ send: async (_id: string, text: string) => { sent.push(text); } }) } as never;
      const settings = createSettingsStore(DEFAULT_SETTINGS, [], { persist: false });
      const t = await testRender(
        <AppContext.Provider value={{ store, ui, runtimes, settings }}>
          <box width={70} height={16}><Composer hostId="h" agentId="a" width={70} maxLines={10} /></box>
        </AppContext.Provider>,
        { width: 70, height: 16 },
      );
      await t.renderOnce();
      t.mockInput.pressKey("a");
      // Terminals send the same CR for shift+Enter, so the newline key is Alt+Enter.
      t.mockInput.pressEnter({ meta: true });
      t.mockInput.pressKey("b");
      await Bun.sleep(30);
      await t.renderOnce();
      expect(sent).toEqual([]); // nothing submitted by Alt+Enter
      expect(ui.getState().drafts["h:a"]).toBe("a\nb");
      t.mockInput.pressEnter();
      await Bun.sleep(30);
      await t.renderOnce();
      expect(sent).toEqual(["a\nb"]);
      t.renderer.destroy();
    } finally {
      console.error = origError;
    }
  });
});

describe("Tab in the composer", () => {
  test("fills the command the draft is heading for", () => {
    expect(slashCompletion("/fo", SLASH_COMMANDS)?.value).toBe("/fork");
    expect(slashCompletion("/m", SLASH_COMMANDS)?.value).toBe("/mode"); // model and mode share "mode"
    expect(slashCompletion("/mod", SLASH_COMMANDS)?.value).toBe("/mode");
    expect(slashCompletion("/model", SLASH_COMMANDS)?.value).toBe("/model"); // already complete: unchanged
    expect(slashCompletion("/mode", SLASH_COMMANDS)?.value).toBe("/mode");
    expect(slashCompletion("/sto", SLASH_COMMANDS)?.value).toBe("/stop");
    expect(slashCompletion("/", SLASH_COMMANDS)).toBeNull(); // nothing typed yet
    expect(slashCompletion("/nope", SLASH_COMMANDS)).toBeNull();
    expect(slashCompletion("git push", SLASH_COMMANDS)).toBeNull();
    expect(slashCompletion("/fork now", SLASH_COMMANDS)).toBeNull(); // arguments: not a completion
  });

  function harness() {
    const store = createSessionStore();
    store.actions.addHost({ id: "h", label: "h", url: "ws://x/ws" });
    store.actions.setActiveHost("h");
    store.actions.setWorkspaces("h", [{ id: "w", projectId: "p", title: "W", status: "idle" } as never]);
    store.actions.setAgents("h", [{ id: "a", status: "idle", cwd: "/r", workspaceId: "w", updatedAt: new Date().toISOString(), provider: "claude", model: "m", title: "A" } as never]);
    const ui = createUiStore();
    ui.actions.selectWorkspace("h", "w");
    ui.actions.updateTabs("h:w", (s) => ({ ...s, tabs: ["a"], active: "a" }));
    ui.actions.setFocus("composer");
    const settings = createSettingsStore(DEFAULT_SETTINGS, [], { persist: false });
    const runtimes = { get: () => ({ send: async () => {} }) } as never;
    installDispatcher({ ui, store, runtimes, settings, quit: () => {} });
    return { store, ui, runtimes, settings };
  }

  async function mount(h: ReturnType<typeof harness>) {
    const origError = console.error;
    console.error = () => {};
    const t = await testRender(
      <AppContext.Provider value={{ store: h.store, ui: h.ui, runtimes: h.runtimes, settings: h.settings }}>
        <box width={70} height={12}><Composer hostId="h" agentId="a" width={70} maxLines={6} /></box>
      </AppContext.Provider>,
      { width: 70, height: 12 },
    );
    await t.renderOnce();
    return { t, settle: async () => { await Bun.sleep(25); await t.renderOnce(); }, done: () => { t.renderer.destroy(); console.error = origError; } };
  }

  test("Tab completes a / command and leaves the pane alone", async () => {
    const h = harness();
    const { t, settle, done } = await mount(h);
    try {
      for (const ch of "/fo") t.mockInput.pressKey(ch);
      await settle();
      t.mockInput.pressTab();
      await settle();
      expect(h.ui.getState().drafts["h:a"]).toBe("/fork");
      expect(h.ui.getState().focus).toBe("composer");
      // The cursor stays at the end: typing after a completion appends.
      t.mockInput.pressKey("x");
      await settle();
      expect(h.ui.getState().drafts["h:a"]).toBe("/forkx");
      expect(h.ui.getState().focus).toBe("composer");
    } finally {
      done();
    }
  });

  test("Tab indents ordinary text instead of switching panes", async () => {
    const h = harness();
    const { t, settle, done } = await mount(h);
    try {
      for (const ch of "if (x) {") t.mockInput.pressKey(ch);
      await settle();
      t.mockInput.pressTab();
      await settle();
      expect(h.ui.getState().drafts["h:a"]).toBe("if (x) {  ");
      expect(h.ui.getState().focus).toBe("composer");
      // And the global binding no longer claims Tab while composing.
      expect(dispatchGlobal(key("tab"))).toBe(false);
    } finally {
      done();
    }
  });

  test("⇧Tab never indents the draft, even when no mode command claims it", async () => {
    // The harness agent has no availableModes, so nothing claims ⇧Tab globally:
    // the composer itself must still refuse to indent on a shifted Tab.
    const h = harness();
    const { t, settle, done } = await mount(h);
    try {
      for (const ch of "a a") t.mockInput.pressKey(ch);
      await settle();
      t.mockInput.pressTab({ shift: true });
      await settle();
      expect(h.ui.getState().drafts["h:a"]).toBe("a a");
      t.mockInput.pressTab();
      await settle();
      expect(h.ui.getState().drafts["h:a"]).toBe("a a  "); // a bare Tab still indents
    } finally {
      done();
    }
  });
});

describe("a new agent in a folder that isn't in the sidebar", () => {
  test("the target is the explicit folder when given, else the current workspace", () => {
    expect(agentTarget({ hostId: "h", workspaceId: "w9", cwd: "/tmp/new", label: "new" }, { hostId: "h", workspace: { id: "w1", workspaceDirectory: "/repo" } }))
      .toEqual({ hostId: "h", workspaceId: "w9", cwd: "/tmp/new", label: "new" });
    expect(agentTarget(undefined, { hostId: "h", workspace: { id: "w1", workspaceDirectory: "/work/acme-web" } }))
      .toEqual({ hostId: "h", workspaceId: "w1", cwd: "/work/acme-web", label: "acme-web" });
    expect(agentTarget(undefined, { hostId: "h", workspace: { id: "w1", projectRootPath: "/work/x" } })).toMatchObject({ label: "x" });
    expect(agentTarget(undefined, { hostId: "h" })).toBeNull();
    expect(agentTarget(undefined, { hostId: null, workspace: { id: "w1" } })).toBeNull();
  });

  test("^N in Add folder opens the folder and then offers a new agent in it", async () => {
    const origError = console.error;
    console.error = () => {};
    try {
      const store = createSessionStore();
      store.actions.addHost({ id: "h", label: "h", url: "ws://x/ws" });
      store.actions.setActiveHost("h");
      const ui = createUiStore();
      const opened: { path: string; create: boolean }[] = [];
      const runtimes = { get: () => ({ openFolder: async (path: string, create: boolean) => { opened.push({ path, create }); return { id: "w-new" }; } }) } as never;
      const settings = createSettingsStore(DEFAULT_SETTINGS, [], { persist: false });
      const t = await testRender(
        <AppContext.Provider value={{ store, ui, runtimes, settings }}>
          <box width={90} height={20}><AddFolderModal /></box>
        </AppContext.Provider>,
        { width: 90, height: 20 },
      );
      await t.renderOnce();
      for (const ch of "/tmp/brand-new") t.mockInput.pressKey(ch);
      await Bun.sleep(20);
      await t.renderOnce();
      t.mockInput.pressKey("n", { ctrl: true });
      await Bun.sleep(30);
      await t.renderOnce();
      expect(opened).toEqual([{ path: "/tmp/brand-new", create: true }]); // a folder that doesn't exist yet
      expect(ui.getState().modal).toEqual({ kind: "newAgent", target: { hostId: "h", workspaceId: "w-new", cwd: "/tmp/brand-new", label: "brand-new" } });
      expect(ui.getState().selectedWorkspace.h).toBe("w-new");
      t.renderer.destroy();
    } finally {
      console.error = origError;
    }
  });

  test("the new-agent dialog starts the agent in that folder, even though nothing is selected", async () => {
    const origError = console.error;
    console.error = () => {};
    try {
      const store = createSessionStore();
      store.actions.addHost({ id: "h", label: "h", url: "ws://x/ws" });
      store.actions.setActiveHost("h");
      const ui = createUiStore(); // no workspace selected at all
      ui.actions.openModal({ kind: "newAgent", target: { hostId: "h", workspaceId: "w-new", cwd: "/tmp/brand-new", label: "brand-new" } });
      const created: unknown[] = [];
      const runtimes = {
        get: () => ({
          providers: async () => ({ entries: [{ provider: "claude", label: "Claude", enabled: true, status: "ready", modes: [{ id: "auto", label: "Auto" }] }] }),
          listModels: async () => ({ models: [{ id: "haiku", label: "Haiku" }] }),
          createAgent: async (opts: unknown) => { created.push(opts); return { id: "a-new" }; },
        }),
      } as never;
      const settings = createSettingsStore(DEFAULT_SETTINGS, [], { persist: false });
      const t = await testRender(
        <AppContext.Provider value={{ store, ui, runtimes, settings }}>
          <box width={90} height={24}><NewAgentModal target={{ hostId: "h", workspaceId: "w-new", cwd: "/tmp/brand-new", label: "brand-new" }} /></box>
        </AppContext.Provider>,
        { width: 90, height: 24 },
      );
      for (let i = 0; i < 4; i++) { await Bun.sleep(25); await t.renderOnce(); }
      expect(t.captureCharFrame()).toContain("brand-new");
      t.mockInput.pressTab(); // off the prompt field, onto the pickers
      await Bun.sleep(20);
      await t.renderOnce();
      t.mockInput.pressEnter();
      await Bun.sleep(40);
      await t.renderOnce();
      expect(created).toEqual([{ workspaceId: "w-new", cwd: "/tmp/brand-new", config: { provider: "claude/haiku", modeId: "auto" } }]);
      expect(ui.getState().tabs["h:w-new"]?.tabs).toEqual(["a-new"]);
      expect(ui.getState().modal).toBeNull();
      t.renderer.destroy();
    } finally {
      console.error = origError;
    }
  });
});

describe("new agent without a workspace", () => {
  test("n with nothing selected asks for a folder, then goes straight to the agent", async () => {
    const store = createSessionStore();
    store.actions.addHost({ id: "h", label: "h", url: "ws://x/ws" });
    store.actions.setActiveHost("h");
    const ui = createUiStore();
    ui.actions.setFocus("sidebar");
    const opened: { path: string; create: boolean }[] = [];
    const runtimes = { get: () => ({ openFolder: async (path: string, create: boolean) => { opened.push({ path, create }); return { id: "w-fresh" }; } }) } as never;
    const settings = createSettingsStore(DEFAULT_SETTINGS, [], { persist: false });
    installDispatcher({ ui, store, runtimes, settings, quit: () => {} });

    expect(dispatchGlobal(key("n"))).toBe(true);
    expect(ui.getState().modal).toEqual({ kind: "addFolder", thenAgent: true });

    const origError = console.error;
    console.error = () => {};
    const t = await testRender(
      <AppContext.Provider value={{ store, ui, runtimes, settings }}>
        <box width={90} height={20}><AddFolderModal thenAgent /></box>
      </AppContext.Provider>,
      { width: 90, height: 20 },
    );
    try {
      await t.renderOnce();
      for (const ch of "/tmp/fresh") t.mockInput.pressKey(ch);
      await Bun.sleep(20);
      await t.renderOnce();
      t.mockInput.pressEnter(); // plain Enter: open it *and* continue to the agent dialog
      await Bun.sleep(30);
      await t.renderOnce();
      expect(opened).toEqual([{ path: "/tmp/fresh", create: false }]);
      expect(ui.getState().modal).toEqual({ kind: "newAgent", target: { hostId: "h", workspaceId: "w-fresh", cwd: "/tmp/fresh", label: "fresh" } });
    } finally {
      t.renderer.destroy();
      console.error = origError;
    }
  });
});
