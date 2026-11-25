/**
 * Every app action is a named command. The palette, the help screen, key handling and
 * user keymaps (settings.keymap) all read this one registry — the Desktop app's
 * action-id pattern, adapted to a terminal.
 */
import type { RuntimeManager } from "../paseo/runtime-manager";
import type { SessionStore } from "../stores/session";
import type { SettingsStore } from "../stores/settings";
import { tabsKey, type UiStore } from "../stores/ui";

export interface CommandCtx {
  ui: UiStore;
  store: SessionStore;
  runtimes: RuntimeManager;
  settings: SettingsStore;
  quit: () => void;
}

export interface Command {
  id: string;
  title: string;
  group: "General" | "Navigation" | "Workspace" | "Agent" | "Hosts" | "Appearance";
  keys: string[];
  /** Also fires while typing in the composer (only for modifier/escape keys). */
  inComposer?: boolean;
  /** Hidden from the palette (still in help). */
  hidden?: boolean;
  when?: (ctx: CommandCtx) => boolean;
  /** Current value shown in the palette when the command has no key (e.g. the live mode). */
  detail?: (ctx: CommandCtx) => string | undefined;
  run: (ctx: CommandCtx) => void | Promise<void>;
}

/** The selected workspace and active agent tab on the active host, read live. */
export function selection(ctx: Pick<CommandCtx, "ui" | "store">) {
  const s = ctx.store.getState();
  const u = ctx.ui.getState();
  const hostId = s.activeHostId;
  const host = hostId ? s.hosts[hostId] : undefined;
  const workspaceId = hostId ? u.selectedWorkspace[hostId] : undefined;
  const workspace = workspaceId ? host?.workspaces[workspaceId] : undefined;
  const tabs = hostId && workspaceId ? u.tabs[tabsKey(hostId, workspaceId)] : undefined;
  const agentId = !u.pickerOpen ? tabs?.active ?? undefined : undefined;
  const agent = agentId ? host?.agents[agentId] : undefined;
  return { hostId, host, workspaceId, workspace, agentId: agent ? agentId : undefined, agent };
}

const hasAgent = (c: CommandCtx) => !!selection(c).agent;
/**
 * Focuses the composer on the next tick: the key that triggered the focus (`i`, Enter)
 * is still being dispatched to the text field, which would insert it as text.
 */
const focusComposer = (c: CommandCtx) => {
  setTimeout(() => c.ui.actions.setFocus("composer"), 0);
};
const runtimeOf = (c: CommandCtx) => {
  const { hostId } = selection(c);
  return hostId ? c.runtimes.get(hostId) : undefined;
};

async function attempt(ctx: CommandCtx, work: () => Promise<unknown>, ok?: string) {
  try {
    await work();
    if (ok) ctx.ui.actions.toast(ok, "success");
  } catch (err) {
    ctx.ui.actions.toast(err instanceof Error ? err.message : String(err), "error", 6000);
  }
}

export const COMMANDS: Command[] = [
  { id: "palette.open", title: "Command palette", group: "General", keys: ["ctrl+k", "ctrl+p"], inComposer: true, hidden: true, run: (c) => c.ui.actions.openModal({ kind: "palette" }) },
  { id: "help.open", title: "Keyboard shortcuts", group: "General", keys: ["?"], run: (c) => c.ui.actions.openModal({ kind: "help" }) },
  { id: "settings.open", title: "Settings", group: "General", keys: [",", "ctrl+,"], run: (c) => c.ui.actions.openModal({ kind: "settings" }) },
  { id: "app.quit", title: "Quit", group: "General", keys: ["q"], run: (c) => c.quit() },

  // Not while composing: there Tab completes a / command or indents (see Composer).
  { id: "focus.cycle", title: "Switch pane", group: "Navigation", keys: ["tab"], inComposer: false, hidden: true, run: (c) => {
    c.ui.actions.cycleFocus(c.settings.getState().settings.panelSide);
  } },
  { id: "sidebar.toggle", title: "Toggle sidebar", group: "Navigation", keys: ["ctrl+b"], inComposer: true, run: (c) => c.ui.actions.toggleSidebar() },
  // Bare keys never reach a command while composing (see dispatch), so these only focus from outside.
  { id: "composer.focus", title: "Write a message", group: "Agent", keys: ["i"], when: hasAgent, run: focusComposer },
  // Enter opens the composer only from the conversation: in the sidebar it opens a workspace.
  { id: "composer.focusEnter", title: "Write a message", group: "Agent", keys: ["return"], hidden: true, when: (c) => hasAgent(c) && c.ui.getState().focus === "main", run: focusComposer },

  { id: "workspace.open", title: "Add folder…", group: "Workspace", keys: ["A"], run: (c) => c.ui.actions.openModal({ kind: "addFolder" }) },
  { id: "panel.toggle", title: "Toggle files & changes panel", group: "Workspace", keys: ["C"], when: (c) => !!selection(c).workspace,
    run: (c) => c.ui.actions.togglePanel() },
  { id: "panel.files", title: "Show files", group: "Workspace", keys: [], when: (c) => !!selection(c).workspace, run: (c) => c.ui.actions.openPanel("files") },
  { id: "panel.changes", title: "Show changes", group: "Workspace", keys: [], when: (c) => !!selection(c).workspace, run: (c) => c.ui.actions.openPanel("changes") },
  { id: "panel.pr", title: "Show pull request", group: "Workspace", keys: ["P"], when: (c) => !!selection(c).workspace, run: (c) => c.ui.actions.openPanel("pr") },
  { id: "pr.create", title: "Create pull request…", group: "Workspace", keys: [],
    when: (c) => !!selection(c).workspace,
    run: (c) => {
      const { hostId, workspaceId, workspace } = selection(c);
      if (!hostId || !workspaceId) return;
      const info = c.store.getState().changes[`${hostId}:${workspaceId}`];
      if (info?.pr) return c.ui.actions.toast(`Already open: ${info.pr.url}`, "info", 12000);
      const branch = info?.checkout?.branch ?? workspace?.title ?? "this branch";
      const ahead = info?.checkout?.ahead ? ` ${info.checkout.ahead} commit${info.checkout.ahead === 1 ? "" : "s"} ahead of ${info.checkout.baseRef ?? "base"}.` : "";
      const dirty = info?.checkout?.isDirty ? " Uncommitted changes are not part of it." : "";
      c.ui.actions.openModal({
        kind: "confirm",
        title: "Create pull request?",
        body: `Branch ${branch}.${ahead}${dirty} The daemon pushes it and opens the pull request on the forge.`,
        confirmLabel: "Create PR",
        action: "workspace.pr",
        payload: `${hostId}:${workspaceId}`,
      });
    } },
  { id: "agent.new", title: "New agent…", group: "Agent", keys: ["ctrl+o", "n"], inComposer: true,
    run: (c) => c.ui.actions.openModal(selection(c).workspace ? { kind: "newAgent" } : { kind: "addFolder", thenAgent: true }) },
  { id: "agent.cancel", title: "Stop the running turn", group: "Agent", keys: ["ctrl+x"], inComposer: true,
    when: (c) => selection(c).agent?.status === "running",
    run: (c) => attempt(c, () => runtimeOf(c)!.cancel(selection(c).agentId!), "Stopped") },
  { id: "agent.cycleMode", title: "Next mode", group: "Agent", keys: ["shift+tab"], inComposer: true, when: (c) => (selection(c).agent?.availableModes?.length ?? 0) > 1,
    run: (c) => {
      const { agent, agentId } = selection(c);
      const modes = agent!.availableModes!;
      const i = modes.findIndex((m) => m.id === agent!.currentModeId);
      const next = modes[(i + 1) % modes.length]!;
      return attempt(c, () => runtimeOf(c)!.setMode(agentId!, next.id), `Mode: ${next.label}`);
    } },
  { id: "agent.mode", title: "Change mode…", group: "Agent", keys: [], when: hasAgent,
    detail: (c) => selection(c).agent?.availableModes?.find((m) => m.id === selection(c).agent?.currentModeId)?.label ?? selection(c).agent?.currentModeId ?? undefined,
    run: (c) => c.ui.actions.openModal({ kind: "mode" }) },
  { id: "agent.model", title: "Change model…", group: "Agent", keys: ["M"], when: hasAgent,
    detail: (c) => selection(c).agent?.model ?? undefined,
    run: (c) => c.ui.actions.openModal({ kind: "model" }) },
  { id: "agent.permissions", title: "Answer questions & review permissions", group: "Agent", keys: ["p"],
    when: (c) => Object.values(selection(c).host?.agents ?? {}).some((a) => (a.pendingPermissions?.length ?? 0) > 0),
    run: (c) => c.ui.actions.openModal({ kind: "permissions" }) },
  { id: "agent.archive", title: "Archive agent…", group: "Agent", keys: [], when: hasAgent, run: (c) => {
    const { agent, agentId } = selection(c);
    c.ui.actions.openModal({ kind: "confirm", title: "Archive agent?", body: `"${agent?.title || "Untitled agent"}" will be archived and its tab closed. You can still find it in Paseo Desktop.`, confirmLabel: "Archive", action: "agent.archive", payload: agentId });
  } },
  { id: "agent.delete", title: "Delete agent…", group: "Agent", keys: ["X"], when: hasAgent, run: (c) => {
    const { agent, agentId } = selection(c);
    c.ui.actions.openModal({ kind: "confirm", title: "Delete agent?", body: `"${agent?.title || "Untitled agent"}" will be stopped and deleted for good. There is no getting it back — pick "Archive agent…" if you might.`, confirmLabel: "Delete", action: "agent.delete", payload: agentId });
  } },

  { id: "hosts.open", title: "Switch host…", group: "Hosts", keys: ["H"], run: (c) => c.ui.actions.openModal({ kind: "hosts" }) },
  { id: "hosts.add", title: "Add host…", group: "Hosts", keys: [], run: (c) => c.ui.actions.openModal({ kind: "addHost" }) },

  { id: "theme.open", title: "Change theme…", group: "Appearance", keys: ["T"], run: (c) => c.ui.actions.openModal({ kind: "settings", section: "appearance" }) },
  { id: "transparency.toggle", title: "Toggle transparent background", group: "Appearance", keys: [], run: (c) => {
    const on = !c.settings.getState().settings.transparent;
    c.settings.actions.update({ transparent: on });
    c.ui.actions.toast(on ? "Transparent background" : "Solid background");
  } },
  { id: "motion.toggle", title: "Toggle animations", group: "Appearance", keys: [], run: (c) => {
    const reduce = !c.settings.getState().settings.reduceMotion;
    c.settings.actions.update({ reduceMotion: reduce });
    c.ui.actions.toast(reduce ? "Animations off" : "Animations on");
  } },
];

/** View-local keys, documented in help but handled by the views themselves. */
export const LOCAL_KEYS: { group: string; keys: string; title: string }[] = [
  { group: "Sidebar", keys: "↑↓ j k", title: "Move" },
  { group: "Sidebar", keys: "⏎ / Space", title: "Open workspace · fold project" },
  { group: "Sidebar", keys: "h l", title: "Fold / unfold" },
  { group: "Tabs", keys: "1–9  [ ]", title: "Go to tab · previous / next" },
  { group: "Tabs", keys: "`", title: "Last used tab" },
  { group: "Tabs", keys: "o  x", title: "Open agent · close tab" },
  { group: "Conversation", keys: "↑↓ j k  ^D ^U", title: "Scroll" },
  { group: "Conversation", keys: "g G", title: "Top (loads older) · bottom" },
  { group: "Conversation", keys: "e  r", title: "Expand activity · show thoughts" },
  { group: "Panel", keys: "[ ]  1 2 3", title: "Files · Changes · PR tab" },
  { group: "Panel", keys: "⏎  h l  .  r", title: "Files: open · fold · dotfiles · refresh" },
  { group: "Panel", keys: "⏎  m", title: "Changes: open diff · what to compare" },
  { group: "Panel", keys: "o  ⏎", title: "PR: open in browser · create" },
  { group: "Composer", keys: "⏎  ⌥⏎ / ^J", title: "Send · new line" },
  { group: "Composer", keys: "Esc", title: "Leave the composer" },
];

/** Defaults overridden by settings.keymap. */
export function resolveCommands(keymap: Record<string, string[]>): Command[] {
  return COMMANDS.map((c) => (keymap[c.id] ? { ...c, keys: keymap[c.id]! } : c));
}
