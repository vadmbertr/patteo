import { EmbeddedTerminalRenderable } from "@opentui/core";
import { extend } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import type { HostRuntime } from "../../paseo/host-runtime";
import { useApp, useSettings, useUi } from "../../stores/context";
import { useTheme } from "../../theme/theme";

declare module "@opentui/react" {
  interface OpenTUIComponents {
    "workspace-terminal": typeof EmbeddedTerminalRenderable;
  }
}
extend({ "workspace-terminal": EmbeddedTerminalRenderable });

export function TerminalPane({ hostId, workspaceId, width, height }: { hostId?: string | null; workspaceId?: string; width: number; height: number }) {
  const { ui, runtimes } = useApp();
  const t = useTheme();
  const command = useSettings((s) => s.settings.terminalShell);
  const focused = useUi((s) => s.focus === "terminal" && !s.modal);
  const view = useRef<EmbeddedTerminalRenderable>(null);
  const shell = useRef<Awaited<ReturnType<HostRuntime["attachShell"]>>>(null);
  const replaying = useRef(false);
  const [status, setStatus] = useState("Opening shell…");
  const cols = Math.max(1, width - 2);
  const rows = Math.max(1, height - 2);
  const size = useRef({ cols, rows });
  size.current = { cols, rows };

  useEffect(() => {
    if (!hostId || !workspaceId) return;
    const runtime = runtimes.get(hostId);
    if (!runtime) {
      setStatus("Host unavailable. Toggle the terminal to retry.");
      return;
    }
    const controller = new AbortController();
    const { signal } = controller;
    let ended = false;
    const end = (error?: string) => {
      if (signal.aborted) return;
      ended = true;
      shell.current = null;
      setStatus(error ? `${error} · toggle to retry` : "Shell exited. Toggle to start a new shell.");
    };
    void runtime.attachShell(workspaceId, command, size.current, (event) => {
      if (signal.aborted) return;
      if (event.type === "output") view.current?.write(event.data);
      else if (event.replay.type === "begin") {
        replaying.current = true;
        view.current?.write("\x1bc");
      } else if (event.replay.type === "data") view.current?.write(event.replay.data);
      else {
        replaying.current = false;
        shell.current?.resize(size.current.cols, size.current.rows);
      }
    }, end, signal).then((session) => {
      if (signal.aborted || ended) return;
      shell.current = session;
      session.resize(size.current.cols, size.current.rows);
      setStatus("");
    }).catch((err: unknown) => end(err instanceof Error ? err.message : String(err)));
    return () => {
      shell.current = null;
      controller.abort();
    };
  }, [hostId, workspaceId, runtimes, command]);

  useEffect(() => {
    const terminal = view.current;
    if (focused && !status) terminal?.focus();
    else terminal?.blur();
    return () => terminal?.blur();
  }, [focused, status]);

  return (
    <box width={width} height={height} flexShrink={0} overflow="hidden" border title=" Terminal "
      borderColor={focused ? t.borderActive : t.border} onMouseDown={() => ui.actions.setFocus("terminal")}>
      <workspace-terminal ref={view} width={cols} height={rows}
        onTerminalResize={(cols, rows) => shell.current?.resize(cols, rows)}
        onData={(data, source) => {
          if (source === "response" && replaying.current) return;
          shell.current?.write(new TextDecoder().decode(data));
        }} />
      {!workspaceId || status ? (
        <box position="absolute" left={0} top={0} width={cols} backgroundColor={t.bg}>
          <text fg={t.muted} wrapMode="word">{workspaceId ? status : "Select a workspace to open its shell."}</text>
        </box>
      ) : null}
    </box>
  );
}
