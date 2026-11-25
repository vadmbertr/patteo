import { useTerminalDimensions } from "@opentui/react";
import { useEffect, useRef } from "react";
import { useApp, useSession, useSettings, useUi } from "../stores/context";
import { tabsKey, type Modal } from "../stores/ui";
import { useTheme } from "../theme/theme";
import { ErrorBoundary } from "./ErrorBoundary";
import { ExplorerPanel, PANEL_MIN_TERM_WIDTH, panelWidth } from "./explorer/ExplorerPanel";
import { AddFolderModal } from "./modals/AddFolderModal";
import { AddHostModal, EditHostModal, HostsModal } from "./modals/HostsModals";
import { NewAgentModal } from "./modals/NewAgentModal";
import { PermissionsModal } from "./modals/PermissionsModal";
import { SettingsModal } from "./modals/SettingsModal";
import { ConfirmModal, HelpModal, ModeModal, ModelModal, PaletteModal } from "./modals/simple";
import { Sidebar, sidebarWidth } from "./sidebar/Sidebar";
import { StatusBar } from "./StatusBar";
import { Toaster } from "./Toaster";
import { useSelectedWorkspace } from "./workspace/use-workspace";
import { closeTab } from "./workspace/tabs-model";
import { WorkspacePane } from "./workspace/WorkspacePane";

const SIDEBAR_SIZES = { narrow: 28, normal: 38, wide: 48 } as const;

export function App() {
  const t = useTheme();
  const { width, height } = useTerminalDimensions();
  const sidebarVisible = useUi((s) => s.sidebarVisible);
  const panelOpen = useUi((s) => s.panelOpen);
  const size = useSettings((s) => s.settings.sidebar);
  const panelSide = useSettings((s) => s.settings.panelSide);
  const { hostId, workspaceId } = useSelectedWorkspace();

  usePermissionToasts();

  const bodyHeight = Math.max(3, height - 1);
  const sbWidth = Math.min(SIDEBAR_SIZES[size], sidebarWidth(width) + (SIDEBAR_SIZES[size] - 38));
  const sidebarCols = sidebarVisible ? Math.max(22, sbWidth) : 0;
  const showPanel = panelOpen && !!hostId && !!workspaceId && width >= PANEL_MIN_TERM_WIDTH;
  const panelCols = showPanel ? panelWidth(width) : 0;
  const panel = showPanel ? (
    <ErrorBoundary label="Panel">
      <ExplorerPanel hostId={hostId} workspaceId={workspaceId!} width={panelCols} height={bodyHeight} />
    </ErrorBoundary>
  ) : null;
  return (
    <box flexDirection="column" width={width} height={height} backgroundColor={t.bg}>
      <box flexDirection="row" height={bodyHeight}>
        {sidebarVisible ? <Sidebar height={bodyHeight} width={sidebarCols} /> : null}
        {panelSide === "left" ? panel : null}
        <ErrorBoundary label="Main pane">
          <WorkspacePane width={Math.max(20, width - sidebarCols - panelCols)} height={bodyHeight} />
        </ErrorBoundary>
        {panelSide === "right" ? panel : null}
      </box>
      <StatusBar />
      <ErrorBoundary label="Dialog">
        <ModalLayer />
      </ErrorBoundary>
      <Toaster />
    </box>
  );
}

function ModalLayer() {
  const modal = useUi((s) => s.modal);
  const confirm = useConfirmAction();
  if (!modal) return null;
  switch (modal.kind) {
    case "palette":
      return <PaletteModal />;
    case "help":
      return <HelpModal />;
    case "newAgent":
      return <NewAgentModal target={modal.target} />;
    case "permissions":
      return <PermissionsModal />;
    case "hosts":
      return <HostsModal />;
    case "addHost":
      return <AddHostModal />;
    case "editHost":
      return <EditHostModal hostId={modal.id} label={modal.label} />;
    case "addFolder":
      return <AddFolderModal thenAgent={modal.thenAgent} />;
    case "settings":
      return <SettingsModal initialSection={modal.section} />;
    case "mode":
      return <ModeModal />;
    case "model":
      return <ModelModal />;
    case "confirm":
      return <ConfirmModal title={modal.title} body={modal.body} confirmLabel={modal.confirmLabel} onConfirm={() => confirm(modal)} />;
  }
}

/** What a confirmed action does. */
function useConfirmAction() {
  const { ui, store, runtimes } = useApp();
  return async (modal: Extract<Modal, { kind: "confirm" }>) => {
    try {
      if (modal.action === "agent.archive") {
        const agentId = modal.payload as string;
        const hostId = store.getState().activeHostId!;
        await runtimes.get(hostId)!.archive(agentId);
        const ws = ui.getState().selectedWorkspace[hostId];
        if (ws) ui.actions.updateTabs(tabsKey(hostId, ws), (s) => closeTab(s, agentId));
        ui.actions.toast("Agent archived", "success");
      } else if (modal.action === "agent.delete") {
        const agentId = modal.payload as string;
        const hostId = store.getState().activeHostId!;
        // The daemon stops a running agent as part of deleting it, and the agent
        // subscription drops it from the store; the tab just needs closing here.
        await runtimes.get(hostId)!.delete(agentId);
        const ws = ui.getState().selectedWorkspace[hostId];
        if (ws) ui.actions.updateTabs(tabsKey(hostId, ws), (s) => closeTab(s, agentId));
        ui.actions.toast("Agent deleted", "success");
      } else if (modal.action === "host.remove") {
        await runtimes.removeHost(modal.payload as string);
        ui.actions.toast("Host removed", "success");
      } else if (modal.action === "workspace.pr") {
        const [hostId, workspaceId] = String(modal.payload).split(":");
        if (!hostId || !workspaceId) throw new Error("No workspace selected");
        const res = await runtimes.get(hostId)!.createPr(workspaceId);
        ui.actions.toast(res.number ? `Pull request #${res.number} created` : "Pull request created", "success", 8000);
        if (res.url) ui.actions.toast(res.url, "info", 15000);
        await runtimes.get(hostId)!.loadChanges(workspaceId, { pr: true });
      }
    } catch (err) {
      ui.actions.toast(err instanceof Error ? err.message : String(err), "error", 6000);
    }
  };
}

/** A toast the first time each permission request shows up (the status bar keeps the count). */
function usePermissionToasts() {
  const { ui } = useApp();
  const hostId = useSession((s) => s.activeHostId);
  const agents = useSession((s) => (hostId ? s.hosts[hostId]?.agents : undefined));
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!agents) return;
    const waiting = Object.values(agents).flatMap((a) =>
      (a.pendingPermissions ?? []).map((p) => ({ id: `${a.id}:${(p as { id: string }).id}`, kind: (p as { kind?: string }).kind, agent: a.title || "An agent" })),
    );
    if (seen.current === null) {
      seen.current = new Set(waiting.map((w) => w.id)); // don't toast what was already pending at startup
      return;
    }
    const fresh = waiting.filter((w) => !seen.current!.has(w.id));
    for (const w of fresh) seen.current.add(w.id);
    const asks = fresh.find((w) => w.kind === "question");
    if (asks) ui.actions.toast(`${asks.agent} asks a question · press p to answer`, "info", 8000);
    else if (fresh.length) ui.actions.toast("Permission needed · press p to review", "info", 6000);
  }, [agents]);
}
