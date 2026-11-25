import { createStore } from "zustand/vanilla";
import * as T from "../ui/workspace/tabs-model";

/** Where a new agent should run: a workspace that may not be selected (or even loaded) yet. */
export interface AgentTarget {
  hostId: string;
  workspaceId: string;
  cwd: string;
  /** Shown in the dialog's title; the folder's name. */
  label: string;
}

export type FocusArea = "sidebar" | "panel" | "main" | "composer";

/** Tabs of the right-hand panel: the file tree, the changes (as per the PR), the PR itself. */
export type PanelTab = "files" | "changes" | "pr";
export const PANEL_TABS: PanelTab[] = ["files", "changes", "pr"];

/** At most one modal is open; it owns all keyboard input while open. */
export type Modal =
  | { kind: "palette" }
  | { kind: "help" }
  | { kind: "newAgent"; target?: AgentTarget }
  | { kind: "permissions" }
  | { kind: "hosts" }
  | { kind: "addHost" }
  | { kind: "editHost"; id: string; label: string }
  | { kind: "addFolder"; thenAgent?: boolean }
  | { kind: "settings"; section?: string }
  | { kind: "model" }
  | { kind: "mode" }
  | { kind: "thinking" }
  | { kind: "confirm"; title: string; body: string; confirmLabel: string; action: string; payload?: unknown };

export interface Toast {
  id: number;
  text: string;
  kind: "info" | "success" | "error";
}

export interface UiState {
  focus: FocusArea;
  sidebarVisible: boolean;
  /** Collapsed project keys, `${hostId}:${projectId}`. */
  collapsed: Record<string, true>;
  /** Sidebar cursor row key (see sidebar model). */
  cursor: string | null;
  /** Workspace shown in the main pane, per host. */
  selectedWorkspace: Record<string, string | undefined>;
  /** Agent tabs per workspace, keyed by tabsKey(hostId, workspaceId). */
  tabs: Record<string, T.WorkspaceTabs>;
  /** Main pane shows the agent picker instead of the active tab. */
  pickerOpen: boolean;
  modal: Modal | null;
  toasts: Toast[];
  /** Unsent composer text per agent, so switching tabs keeps drafts. */
  drafts: Record<string, string>;
  /** The Files / Changes / PR panel is showing. */
  panelOpen: boolean;
  panelTab: PanelTab;
  /** File whose diff replaces the conversation in the main pane. */
  diffPath: string | null;
  /** File whose contents replace the conversation in the main pane. */
  filePath: string | null;
  /** Files tab: show dotfiles (Desktop's eye toggle). */
  showHidden: boolean;
  /** Expanded directories in the Files tab, `${hostId}:${workspaceId}:${path}`. */
  expanded: Record<string, true>;
}

export const tabsKey = (hostId: string, workspaceId: string) => `${hostId}:${workspaceId}`;

/** The subset of UI state saved to state.json. */
export type PersistedUi = Pick<UiState, "collapsed" | "selectedWorkspace" | "tabs" | "sidebarVisible">;

let toastSeq = 0;

export function createUiStore(initial: Partial<PersistedUi> = {}) {
  const store = createStore<UiState>()(() => ({
    focus: "sidebar",
    sidebarVisible: true,
    collapsed: {},
    cursor: null,
    selectedWorkspace: {},
    tabs: {},
    pickerOpen: false,
    modal: null,
    toasts: [],
    drafts: {},
    panelOpen: false,
    panelTab: "files",
    diffPath: null,
    filePath: null,
    showHidden: true,
    expanded: {},
    ...initial,
  }));
  const set = store.setState;
  const actions = {
    setFocus: (focus: FocusArea) => set({ focus }),
    /** Tab order follows the screen: sidebar, then the panel and the main pane in layout order. */
    cycleFocus: (panelSide: "left" | "right" = "right") =>
      set((s) => {
        if (s.focus === "composer") return { focus: "main" };
        const rest: FocusArea[] = !s.panelOpen ? ["main"] : panelSide === "left" ? ["panel", "main"] : ["main", "panel"];
        const order: FocusArea[] = [...(s.sidebarVisible ? (["sidebar"] as const) : []), ...rest];
        const i = Math.max(0, order.indexOf(s.focus));
        return { focus: order[(i + 1) % order.length] ?? "main" };
      }),
    /** Opens or closes the panel; opening focuses it, closing drops any diff/file view. */
    togglePanel: () =>
      set((s) =>
        s.panelOpen
          ? { panelOpen: false, diffPath: null, filePath: null, focus: s.focus === "panel" ? "main" : s.focus }
          : { panelOpen: true, focus: "panel" },
      ),
    /** Shows one tab (opening the panel if needed) and focuses it. */
    openPanel: (panelTab: PanelTab) => set({ panelOpen: true, panelTab, focus: "panel" }),
    setPanelTab: (panelTab: PanelTab) => set({ panelTab }),
    /** The main pane shows one thing at a time: a diff, a file, or the conversation. */
    setDiffPath: (diffPath: string | null) => set((s) => ({ diffPath, filePath: diffPath ? null : s.filePath })),
    setFilePath: (filePath: string | null) => set((s) => ({ filePath, diffPath: filePath ? null : s.diffPath })),
    toggleHidden: () => set((s) => ({ showHidden: !s.showHidden })),
    toggleExpanded: (key: string, expanded?: boolean) =>
      set((s) => {
        const open = !!s.expanded[key];
        const next = expanded ?? !open;
        if (next === open) return s;
        const { [key]: _, ...rest } = s.expanded;
        return { expanded: next ? { ...rest, [key]: true } : rest };
      }),
    openModal: (modal: Modal) => set({ modal }),
    closeModal: () => set({ modal: null }),
    toast: (text: string, kind: Toast["kind"] = "info", ttlMs = 3500) => {
      const id = ++toastSeq;
      set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, kind }] }));
      setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ttlMs);
    },
    setDraft: (agentKey: string, text: string) =>
      set((s) => {
        if ((s.drafts[agentKey] ?? "") === text) return s;
        const { [agentKey]: _, ...rest } = s.drafts;
        return { drafts: text ? { ...rest, [agentKey]: text } : rest };
      }),
    toggleSidebar: () =>
      set((s) => ({ sidebarVisible: !s.sidebarVisible, focus: s.sidebarVisible ? "main" : "sidebar" })),
    setCursor: (cursor: string | null) => set({ cursor }),
    toggleCollapsed: (key: string, collapsed?: boolean) =>
      set((s) => {
        const isCollapsed = !!s.collapsed[key];
        const next = collapsed ?? !isCollapsed;
        if (next === isCollapsed) return s;
        const { [key]: _, ...rest } = s.collapsed;
        return { collapsed: next ? { ...rest, [key]: true } : rest };
      }),
    selectWorkspace: (hostId: string, workspaceId: string) =>
      set((s) => ({ selectedWorkspace: { ...s.selectedWorkspace, [hostId]: workspaceId }, pickerOpen: false })),
    /** Applies a pure tab transition to one workspace; no-op transitions don't notify. */
    updateTabs: (key: string, fn: (t: T.WorkspaceTabs) => T.WorkspaceTabs) =>
      set((s) => {
        const prev = s.tabs[key] ?? T.emptyTabs();
        const next = fn(prev);
        if (next === prev) return s;
        return { tabs: { ...s.tabs, [key]: next } };
      }),
    setPickerOpen: (pickerOpen: boolean) => set({ pickerOpen }),
  };
  return Object.assign(store, { actions });
}

export type UiStore = ReturnType<typeof createUiStore>;
