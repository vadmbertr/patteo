import { useTerminalDimensions } from "@opentui/react";
import { useActiveHost, useUi } from "../stores/context";
import { tabsKey } from "../stores/ui";
import { useTheme } from "../theme/theme";
import { SpinnerSpan } from "./motion/Motion";

/** One quiet line: connection + activity on the left, the keys that matter right now on the right. */
export function StatusBar() {
  const t = useTheme();
  const host = useActiveHost();
  const { width } = useTerminalDimensions();
  const focus = useUi((s) => s.focus);
  const diffPath = useUi((s) => s.diffPath);
  const panelOpen = useUi((s) => s.panelOpen);
  const panelTab = useUi((s) => s.panelTab);
  const filePath = useUi((s) => s.filePath);
  const pickerShown = useUi((s) => {
    if (s.pickerOpen) return true;
    const ws = host ? s.selectedWorkspace[host.config.id] : undefined;
    return !ws || !(s.tabs[tabsKey(host!.config.id, ws)]?.tabs.length);
  });
  const agents = host ? Object.values(host.agents).filter((a) => !a.archivedAt) : [];
  const running = agents.filter((a) => a.status === "running").length;
  const permissions = agents.reduce((n, a) => n + (a.pendingPermissions?.length ?? 0), 0);
  const questions = agents.reduce((n, a) => n + ((a.pendingPermissions ?? []) as { kind?: string }[]).filter((p) => p.kind === "question").length, 0);

  const c = host?.connection;
  const conn =
    !c ? { text: "no host", color: t.subtle }
    : c.status === "connected" ? null
    : c.status === "connecting" ? { text: "connecting…", color: t.warning }
    : c.status === "disconnected"
      ? { text: `disconnected${c.retryAt ? ` · retry ${Math.max(0, Math.ceil((c.retryAt - Date.now()) / 1000))}s` : ""}`, color: t.error }
      : null;

  const PANEL_HINTS = {
    files: "↑↓ move  ⏎ open  h/l fold  . dotfiles  [ ] tab  esc back",
    changes: "↑↓ file  ⏎ diff  m compare  r refresh  [ ] tab  esc back",
    pr: "o open  ⏎ create  r refresh  [ ] tab  esc back",
  } as const;
  const toggle = panelOpen ? "C hide panel  " : "";
  let hints: string;
  if (focus === "terminal") hints = "F2 hide terminal · click another pane to leave";
  else if (diffPath) hints = "j/k scroll  [ ] file  esc back";
  else if (filePath) hints = "j/k scroll  g/G top/bottom  esc back";
  else if (focus === "panel") hints = PANEL_HINTS[panelTab];
  else if (focus === "composer") hints = "⏎ send  ⌥⏎ newline  ⇧tab mode  esc leave  ^k commands";
  else if (focus === "sidebar") hints = `${toggle}↑↓ move  ⏎ open  ^k commands  ? help`;
  else hints = pickerShown ? "↑↓ select  ⏎ open  n new  esc back" : `${panelOpen ? toggle : "C panel  "}i write  ↑↓ scroll  e activity  ^k commands`;

  return (
    <box height={1} flexShrink={0} flexDirection="row" justifyContent="space-between" paddingLeft={2} paddingRight={2} backgroundColor={t.bg}>
      <text>
        {conn ? <span fg={conn.color}>{`${conn.text}  `}</span> : null}
        {running > 0 ? (
          <>
            <SpinnerSpan color={t.info} />
            <span fg={t.info}>{` ${running} running  `}</span>
          </>
        ) : null}
        {questions > 0 ? <span fg={t.info}>{`? ${questions} asking · p  `}</span> : null}
        {permissions - questions > 0 ? <span fg={t.warning}>{`⚠ ${permissions - questions} waiting · p  `}</span> : null}
      </text>
      <text fg={t.subtle}>{width >= 70 ? hints : ""}</text>
    </box>
  );
}
