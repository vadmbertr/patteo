// Modified by Paseo Box: render the emissions overlay in the modal layer.
import { useTerminalDimensions } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import { useApp, useSession, useSettings, useUi } from "../stores/context";
import { tabsKey, type Modal } from "../stores/ui";
import { useTheme } from "../theme/theme";
import { ErrorBoundary } from "./ErrorBoundary";
import { ExplorerPanel, PANEL_MIN_TERM_WIDTH, panelWidth } from "./explorer/ExplorerPanel";
import { AddFolderModal } from "./modals/AddFolderModal";
import { ArchiveWorkspaceModal } from "./modals/ArchiveWorkspaceModal";
import { EmissionsModal } from "./modals/EmissionsModal";
import { AddHostModal, EditHostModal, HostsModal } from "./modals/HostsModals";
import { NewAgentModal } from "./modals/NewAgentModal";
import { PermissionsModal } from "./modals/PermissionsModal";
import { SettingsModal } from "./modals/SettingsModal";
import { ConfirmModal, HelpModal, ModeModal, ModelModal, PaletteModal, ThinkingModal, AgentsModal } from "./modals/simple";
import { Sidebar, sidebarWidth } from "./sidebar/Sidebar";
import { StatusBar } from "./StatusBar";
import { Toaster } from "./Toaster";
import { useSelectedWorkspace } from "./workspace/use-workspace";
import { closeTab } from "./workspace/tabs-model";
import { WorkspacePane } from "./workspace/WorkspacePane";
import { TerminalPane } from "./workspace/TerminalPane";

const SIDEBAR_SIZES = { narrow: 28, normal: 38, wide: 48 } as const;
const MAIN_MIN = 20;
const TERMINAL_MIN = 20;
const clampWidth = (width: number, min: number, max: number) => Math.min(Math.max(width, min), max);

function Divider({ name, width, min, max, grow, onResize }: {
  name: string; width: number; min: number; max: number; grow: 1 | -1; onResize: (width: number) => void;
}) {
  const t = useTheme();
  const { ui } = useApp();
  const start = useRef<{ x: number; width: number; min: number; max: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const finish = () => {
    start.current = null;
    setDragging(false);
  };
  return <box id={`resize-${name}`} width={1} height="100%" flexShrink={0}
    backgroundColor={dragging ? t.accent : t.border}
    onMouseDown={(event) => {
      if (event.button !== 0 || ui.getState().modal) return;
      event.stopPropagation();
      start.current = { x: event.x, width, min, max };
    }}
    onMouseDrag={(event) => {
      const drag = start.current;
      if (!drag || ui.getState().modal) return;
      setDragging(true);
      onResize(clampWidth(drag.width + grow * (event.x - drag.x), drag.min, drag.max));
    }}
    onMouseUp={finish}
    onMouseDragEnd={finish} />;
}

export function App() {
  const { ui } = useApp();
  const t = useTheme();
  const { width, height } = useTerminalDimensions();
  const sidebarVisible = useUi((s) => s.sidebarVisible);
  const panelOpen = useUi((s) => s.panelOpen);
  const terminalOpen = useUi((s) => s.terminalOpen);
  const size = useSettings((s) => s.settings.sidebar);
  const panelSide = useSettings((s) => s.settings.panelSide);
  const { hostId, workspaceId } = useSelectedWorkspace();
  const [sidebarWidthOverride, setSidebarWidth] = useState<number>();
  const [explorerWidthOverride, setExplorerWidth] = useState<number>();
  const [terminalWidthOverride, setTerminalWidth] = useState<number>();

  usePermissionToasts();

  const bodyHeight = Math.max(3, height - 1);
  const explorerMin = panelWidth(PANEL_MIN_TERM_WIDTH);
  const layoutChat = (available: number) => {
    const sbWidth = Math.min(SIDEBAR_SIZES[size], sidebarWidth(available) + (SIDEBAR_SIZES[size] - 38));
    const narrowSidebar = Math.max(22, sidebarWidth(available) + SIDEBAR_SIZES.narrow - SIDEBAR_SIZES.normal);
    const showSidebar = sidebarVisible && available >= MAIN_MIN + narrowSidebar + 1;
    const showPanel = panelOpen && !!hostId && !!workspaceId && available >= PANEL_MIN_TERM_WIDTH;
    const leftBudget = available - MAIN_MIN - Number(showSidebar) - Number(showPanel);
    const sidebarCols = showSidebar ? clampWidth(sidebarWidthOverride ?? sbWidth, narrowSidebar, leftBudget - (showPanel ? explorerMin : 0)) : 0;
    const panelCols = showPanel ? clampWidth(explorerWidthOverride ?? panelWidth(available), explorerMin, leftBudget - sidebarCols) : 0;
    const mainCols = available - sidebarCols - panelCols - Number(showSidebar) - Number(showPanel);
    return { narrowSidebar, showSidebar, showPanel, leftBudget, sidebarCols, panelCols, mainCols };
  };
  const terminalCols = terminalOpen
    ? clampWidth(terminalWidthOverride ?? Math.floor(layoutChat(width).mainCols / 2), TERMINAL_MIN, Math.max(0, width - MAIN_MIN - 1))
    : 0;
  const leftWidth = width - terminalCols - Number(terminalCols > 0);
  const { narrowSidebar, showSidebar, showPanel, leftBudget, sidebarCols, panelCols, mainCols } = layoutChat(leftWidth);
  const panelDivider = showPanel ? (
    <Divider name="explorer" width={panelCols} min={explorerMin} max={leftBudget - sidebarCols}
      grow={panelSide === "left" ? 1 : -1} onResize={setExplorerWidth} />
  ) : null;
  const panel = showPanel && hostId && workspaceId ? (
    <ErrorBoundary label="Panel">
      <ExplorerPanel hostId={hostId} workspaceId={workspaceId} width={panelCols} height={bodyHeight} />
    </ErrorBoundary>
  ) : null;
  return (
    <box flexDirection="column" width={width} height={height} backgroundColor={t.bg}>
      <box flexDirection="row" height={bodyHeight}>
        <box flexDirection="row" width={leftWidth} flexShrink={0} overflow="hidden" onMouseDown={() => {
          if (ui.getState().focus === "terminal") ui.actions.setFocus("main");
        }}>
          {sidebarCols ? <Sidebar height={bodyHeight} width={sidebarCols} /> : null}
          {showSidebar ? <Divider name="sidebar" width={sidebarCols} min={narrowSidebar} max={leftBudget - panelCols} grow={1} onResize={setSidebarWidth} /> : null}
          {panelSide === "left" ? panel : null}
          {panelSide === "left" ? panelDivider : null}
          <ErrorBoundary label="Main pane">
            <WorkspacePane width={Math.max(1, mainCols)} height={bodyHeight} />
          </ErrorBoundary>
          {panelSide === "right" ? panelDivider : null}
          {panelSide === "right" ? panel : null}
        </box>
        {terminalCols > 0 ? (
          <>
            <Divider name="terminal" width={terminalCols} min={Math.min(TERMINAL_MIN, terminalCols)}
              max={width - 1 - (showPanel ? PANEL_MIN_TERM_WIDTH : MAIN_MIN + (showSidebar ? narrowSidebar + 1 : 0))}
              grow={-1} onResize={setTerminalWidth} />
            <ErrorBoundary label="Terminal" resetKey={`${hostId}:${workspaceId}`}>
              <TerminalPane key={`${hostId}:${workspaceId}`} hostId={hostId} workspaceId={workspaceId} width={terminalCols} height={bodyHeight} />
            </ErrorBoundary>
          </>
        ) : null}
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
    case "emissions":
      return <EmissionsModal />;
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
    case "archiveWorkspace":
      return <ArchiveWorkspaceModal />;
    case "removeProject":
      return <ArchiveWorkspaceModal projects />;
    case "settings":
      return <SettingsModal initialSection={modal.section} />;
    case "mode":
      return <ModeModal />;
    case "model":
      return <ModelModal />;
    case "thinking":
      return <ThinkingModal />;
    case "agents":
      return <AgentsModal />;
    case "subagents":
      return <AgentsModal subagents />;
    case "confirm":
      return <ConfirmModal title={modal.title} body={modal.body} confirmLabel={modal.confirmLabel} onConfirm={() => confirm(modal)} />;
  }
}

/** What a confirmed action does. */
function useConfirmAction() {
  const { ui, store, runtimes } = useApp();
  const forgetWorkspace = (hostId: string, workspaceId: string) => {
    if (store.getState().activeHostId === hostId && ui.getState().selectedWorkspace[hostId] === workspaceId) {
      ui.actions.setDiffPath(null);
      ui.actions.setFilePath(null);
      ui.actions.setFocus(ui.getState().sidebarVisible ? "sidebar" : "main");
    }
    ui.actions.forgetWorkspace(hostId, workspaceId);
  };
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
      } else if (modal.action === "workspace.archive") {
        const { hostId, workspaceId } = modal.payload as { hostId: string; workspaceId: string };
        const runtime = runtimes.get(hostId);
        if (!runtime) throw new Error("Host unavailable");
        await runtime.archiveWorkspace(workspaceId);
        forgetWorkspace(hostId, workspaceId);
        ui.actions.toast("Workspace archived", "success");
      } else if (modal.action === "project.remove") {
        const { hostId, projectId } = modal.payload as { hostId: string; projectId: string };
        const runtime = runtimes.get(hostId);
        if (!runtime) throw new Error("Host unavailable");
        for (const id of await runtime.removeProject(projectId)) forgetWorkspace(hostId, id);
        ui.actions.toast("Project removed", "success");
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
