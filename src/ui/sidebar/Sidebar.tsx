import { useKeyboard } from "@opentui/react";
import { viewShouldIgnore } from "../../keyboard/dispatch";
import { confirmArchiveWorkspace, confirmRemoveProject } from "../../keyboard/commands";
import { TextAttributes } from "@opentui/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useActiveHost, useApp, useUi } from "../../stores/context";
import { useTheme } from "../../theme/theme";
import { isVersionSkewed } from "../../paseo/host-runtime";
import { buildSidebarRows, moveCursor, resolveCursor, type SidebarRow } from "./model";
import { workspaceStatusGlyph } from "../status";
import { padEnd, truncate } from "../text";
import { placeRows, scrollToShow, type PlacedRow } from "./layout";
import { Shimmer, Skeleton, SpinnerSpan } from "../motion/Motion";

export const SIDEBAR_MAX_WIDTH = 38;
/** Up to 36 columns, but never more than ~40% of a narrow terminal. */
export const sidebarWidth = (terminalWidth: number) => Math.max(22, Math.min(SIDEBAR_MAX_WIDTH, Math.floor(terminalWidth * 0.4)));

export function Sidebar({ height, width }: { height: number; width: number }) {
  const t = useTheme();
  const { ui, store } = useApp();
  const host = useActiveHost();
  const focused = useUi((s) => s.focus === "sidebar");
  const collapsed = useUi((s) => s.collapsed);
  const cursorRaw = useUi((s) => s.cursor);
  const selected = useUi((s) => (host ? s.selectedWorkspace[host.config.id] : undefined));

  const rows = useMemo(
    () =>
      host
        ? buildSidebarRows({
            hostId: host.config.id,
            projects: host.projects,
            workspaces: host.workspaces,
            agents: host.agents,
            collapsed,
          })
        : [],
    [host?.config.id, host?.projects, host?.workspaces, host?.agents, collapsed],
  );
  const cursor = resolveCursor(rows, cursorRaw);
  // Key handlers read live values: several keys can arrive before React re-renders.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  useEffect(() => {
    if (cursor !== cursorRaw) ui.actions.setCursor(cursor);
  }, [cursor, cursorRaw]);

  // Line-based windowing (rows have different heights); keeps the cursor's row fully visible.
  // Borders (2) + host header + spacer.
  const listHeight = Math.max(2, height - 4);
  const { placed, totalLines } = useMemo(() => placeRows(rows), [rows]);
  const [scroll, setScroll] = useState(0);
  const nextScroll = scrollToShow(placed, totalLines, cursor, scroll, listHeight);
  useEffect(() => {
    if (nextScroll !== scroll) setScroll(nextScroll);
  }, [nextScroll]);

  const activate = (row: SidebarRow, focusMain: boolean) => {
    const hostId = store.getState().activeHostId;
    if (!hostId) return;
    ui.actions.setCursor(row.key);
    if (row.kind === "project") ui.actions.toggleCollapsed(row.key);
    else {
      ui.actions.selectWorkspace(hostId, row.workspaceId);
      if (focusMain) ui.actions.setFocus("main");
    }
  };

  useKeyboard((k) => {
    if (viewShouldIgnore(k)) return;
    const hostId = store.getState().activeHostId;
    if (ui.getState().focus !== "sidebar" || !hostId) return;
    const rows = rowsRef.current;
    const cursor = resolveCursor(rows, ui.getState().cursor);
    const row = rows.find((r) => r.key === cursor);
    const move = (d: number) => ui.actions.setCursor(moveCursor(rows, ui.getState().cursor ?? cursor, d));
    switch (k.name) {
      case "a":
        if (!k.shift && !k.ctrl && !k.meta && !k.option && !k.super) {
          if (row?.kind === "workspace") confirmArchiveWorkspace({ ui, store }, hostId, row.workspaceId);
          if (row?.kind === "project") confirmRemoveProject({ ui, store }, hostId, row.projectId);
        }
        return;
      case "j":
      case "down":
        return move(1);
      case "k":
      case "up":
        return move(-1);
      case "pagedown":
        return move(Math.max(1, Math.floor(listHeight / 2)));
      case "pageup":
        return move(-Math.max(1, Math.floor(listHeight / 2)));
      case "g":
        return ui.actions.setCursor(k.shift ? rows.at(-1)?.key ?? null : rows[0]?.key ?? null);
      case "home":
        return ui.actions.setCursor(rows[0]?.key ?? null);
      case "end":
        return ui.actions.setCursor(rows.at(-1)?.key ?? null);
      case "return":
      case "enter":
        return row && activate(row, true);
      case "space":
        return row && activate(row, false);
      case "l":
      case "right":
        if (row?.kind === "project") return ui.actions.toggleCollapsed(row.key, false);
        return row && activate(row, false);
      case "h":
      case "left":
        if (row?.kind === "project") return ui.actions.toggleCollapsed(row.key, true);
        if (row?.kind === "workspace") return ui.actions.setCursor(row.projectKey);
        return;
    }
  });

  const loading = host && !(host.loaded.projects && host.loaded.workspaces);
  const view = nextScroll;
  // Rows fully inside the window; a project's gap line is dropped when it would sit at the top.
  const visible = placed.filter((p) => p.top + (p.gapBefore ? 1 : 0) >= view && p.top + p.height <= view + listHeight);
  const inner = width - 4;
  const above = placed.some((p) => p.top + p.height <= view);
  const below = placed.some((p) => p.top + p.height > view + listHeight);

  return (
    <box
      width={width}
      flexShrink={0}
      flexDirection="column"
      backgroundColor={t.panel}
      border
      borderStyle="rounded"
      borderColor={focused ? t.borderActive : t.border}
      title=" Workspaces "
      titleColor={focused ? t.accent : t.muted}
      bottomTitle={above || below ? ` ${above ? "▲" : " "}${below ? "▼" : " "} ` : undefined}
      bottomTitleAlignment="right"
      paddingLeft={1}
      paddingRight={1}
    >
      <HostHeader width={inner} />
      <box height={1} flexShrink={0} />
      {!host ? (
        <text fg={t.muted}>{"No host configured"}</text>
      ) : loading ? (
        <box flexDirection="column">
          <text wrapMode="none">
            <Shimmer text={host.connection.status === "connected" ? "Loading workspaces…" : "Waiting for daemon…"} />
          </text>
          <box height={1} />
          <Skeleton rows={Math.max(2, Math.min(8, Math.floor((height - 6) / 2)))} width={inner} widths={[0.45, 0.8, 0.6, 0.35, 0.75, 0.55]} indent={1} gap={1} />
        </box>
      ) : rows.length === 0 ? (
        <text fg={t.muted}>{"No projects yet"}</text>
      ) : (
        visible.map((p) => (
          <Row
            key={p.row.key}
            placed={p}
            showGap={p.gapBefore && p.top >= view}
            width={inner}
            isCursor={p.row.key === cursor}
            isSelected={p.row.kind === "workspace" && p.row.workspaceId === selected}
            focused={focused}
            onClick={() => {
              ui.actions.setFocus("sidebar");
              activate(p.row, false);
            }}
          />
        ))
      )}
    </box>
  );
}

function HostHeader({ width }: { width: number }) {
  const t = useTheme();
  const host = useActiveHost();
  if (!host) return <text fg={t.muted}>{"—"}</text>;
  const c = host.connection;
  const dot = c.status === "connected" ? t.success : c.status === "connecting" ? t.warning : t.error;
  const version = host.serverVersion ? `v${host.serverVersion}` : c.status === "connected" ? "" : c.status;
  const skew = isVersionSkewed(host.serverVersion);
  const label = truncate(host.config.label, Math.max(4, width - version.length - 5));
  return (
    <text flexShrink={0}>
      {c.status === "connected" ? <span fg={dot}>{"●"}</span> : <SpinnerSpan color={dot} />}
      <span>{" "}</span>
      <span fg={t.text} attributes={TextAttributes.BOLD}>{label}</span>
      <span fg={skew ? t.warning : t.subtle}>{`  ${version}${skew ? " ⚠" : ""}`}</span>
    </text>
  );
}

function Row(props: {
  placed: PlacedRow;
  showGap: boolean;
  width: number;
  isCursor: boolean;
  isSelected: boolean;
  focused: boolean;
  onClick: () => void;
}) {
  const t = useTheme();
  const { width, isCursor, isSelected, focused } = props;
  const row = props.placed.row;
  const gap = props.showGap ? <box height={1} flexShrink={0} /> : null;

  if (row.kind === "project") {
    const empty = row.workspaceCount === 0;
    const caret = empty ? " " : row.collapsed ? "▸" : "▾";
    const roll = row.collapsed ? workspaceStatusGlyph(row.status, t) : null;
    const suffix = row.collapsed && !empty ? `${row.workspaceCount}` : "";
    const labelWidth = Math.max(4, width - 2 - suffix.length - (roll?.glyph.trim() ? 2 : 0) - 1);
    const bg = isCursor && focused ? t.element : undefined;
    return (
      <>
        {gap}
        <box height={1} flexShrink={0} backgroundColor={bg} onMouseDown={props.onClick}>
          <text>
            <span fg={t.subtle}>{`${caret} `}</span>
            <span fg={empty ? t.subtle : t.muted} attributes={empty ? TextAttributes.NONE : TextAttributes.BOLD}>
              {padEnd(truncate(row.label, labelWidth), labelWidth)}
            </span>
            {roll?.glyph.trim() ? <span fg={roll.color}>{` ${roll.glyph}`}</span> : null}
            <span fg={t.subtle}>{` ${suffix}`}</span>
          </text>
        </box>
      </>
    );
  }

  // Workspace: two lines (title, then branch/agents), the selected one as a filled block with an accent bar.
  const st = workspaceStatusGlyph(row.status, t);
  const glyph = row.status === "done" ? { glyph: "○", color: t.subtle } : st;
  const bg = isCursor && focused ? t.element : isSelected ? t.raised : undefined;
  const bar = isSelected ? "▌" : " ";
  const agents = row.agents.total === 0 ? "no agents" : `${row.agents.total} agent${row.agents.total === 1 ? "" : "s"}`;
  const meta = [row.branch ? `⑂ ${row.branch}` : row.isWorktree ? "worktree" : null, agents].filter(Boolean).join(" · ");
  const warn = row.agents.permissions > 0 ? `⚠ ${row.agents.permissions} waiting` : "";
  const textWidth = Math.max(4, width - 4);
  return (
    <box flexDirection="column" flexShrink={0} backgroundColor={bg} onMouseDown={props.onClick}>
      <text>
        <span fg={t.accent}>{bar}</span>
        <span>{" "}</span>
        {row.status === "running" ? <SpinnerSpan color={glyph.color} /> : <span fg={glyph.color}>{glyph.glyph}</span>}
        <span>{" "}</span>
        <span fg={isSelected ? t.text : t.muted} attributes={isSelected ? TextAttributes.BOLD : TextAttributes.NONE}>
          {padEnd(truncate(row.label, textWidth), textWidth)}
        </span>
      </text>
      <text>
        <span fg={t.accent}>{bar}</span>
        <span>{"   "}</span>
        {warn ? (
          <span fg={t.warning}>{truncate(warn, textWidth)}</span>
        ) : (
          <span fg={t.subtle}>{padEnd(truncate(meta, textWidth), textWidth)}</span>
        )}
      </text>
    </box>
  );
}
