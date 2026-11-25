import { TextAttributes } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useMemo, useState } from "react";
import { activeCommands, commandContext, runCommand } from "../../keyboard/dispatch";
import { LOCAL_KEYS, selection } from "../../keyboard/commands";
import { keyLabel } from "../../keyboard/keys";
import { useApp } from "../../stores/context";
import { useTheme } from "../../theme/theme";
import { Skeleton } from "../motion/Motion";
import { padEnd } from "../text";
import { Overlay, overlayInner } from "./Overlay";
import { SelectList, type ListItem } from "./SelectList";

export function PaletteModal() {
  const { ui } = useApp();
  const t = useTheme();
  const { width } = useTerminalDimensions();
  const ctx = commandContext();
  const items: ListItem[] = activeCommands()
    .filter((c) => ctx && !c.hidden && (c.when?.(ctx) ?? true))
    .map((c) => ({ id: c.id, label: c.title, hint: c.keys[0] ? keyLabel(c.keys[0]) : (c.detail?.(ctx!) ?? ""), marker: { glyph: "›", color: t.subtle } }));
  return (
    <Overlay title="Commands" width={64} height={18} footer="⏎ run · esc close">
      <SelectList
        items={items}
        width={overlayInner(64, width)}
        height={14}
        placeholder="Search commands"
        onCancel={() => ui.actions.closeModal()}
        onSelect={(it) => {
          ui.actions.closeModal();
          runCommand(it.id);
        }}
      />
    </Overlay>
  );
}

export function HelpModal() {
  const { ui } = useApp();
  const t = useTheme();
  const dims = useTerminalDimensions();
  const [scroll, setScroll] = useState(0);
  const lines = useMemo(() => {
    const out: { kind: "head" | "row"; keys?: string; title: string }[] = [];
    const groups = new Map<string, { keys: string; title: string }[]>();
    for (const c of activeCommands()) {
      if (!c.keys.length) continue;
      const g = groups.get(c.group) ?? [];
      g.push({ keys: c.keys.map(keyLabel).join("  "), title: c.title });
      groups.set(c.group, g);
    }
    for (const l of LOCAL_KEYS) {
      const g = groups.get(l.group) ?? [];
      g.push({ keys: l.keys, title: l.title });
      groups.set(l.group, g);
    }
    for (const [group, rows] of groups) {
      out.push({ kind: "head", title: group });
      for (const r of rows) out.push({ kind: "row", ...r });
    }
    return out;
  }, []);
  const height = Math.min(32, dims.height - 2);
  const view = height - 3;
  useKeyboard((k) => {
    if (k.name === "escape" || k.name === "q" || k.sequence === "?") return ui.actions.closeModal();
    if (k.name === "j" || k.name === "down") setScroll((s) => Math.min(Math.max(0, lines.length - view), s + 1));
    if (k.name === "k" || k.name === "up") setScroll((s) => Math.max(0, s - 1));
  });
  return (
    <Overlay title="Keyboard shortcuts" width={66} height={height} footer="esc close · keys can be remapped in config.json">
      {lines.slice(scroll, scroll + view).map((l, i) =>
        l.kind === "head" ? (
          <text key={i} fg={t.accent} attributes={TextAttributes.BOLD}>{l.title}</text>
        ) : (
          <text key={i} wrapMode="none">
            <span fg={t.text}>{`  ${padEnd(l.keys!, 18)}`}</span>
            <span fg={t.muted}>{l.title}</span>
          </text>
        ),
      )}
    </Overlay>
  );
}

export function ConfirmModal({ title, body, confirmLabel, onConfirm }: { title: string; body: string; confirmLabel: string; onConfirm: () => void }) {
  const { ui } = useApp();
  const t = useTheme();
  useKeyboard((k) => {
    if (k.name === "escape" || k.name === "n") return ui.actions.closeModal();
    if (k.name === "return" || k.name === "y") {
      ui.actions.closeModal();
      onConfirm();
    }
  });
  return (
    <Overlay title={title} width={56} height={8}>
      <text fg={t.text} wrapMode="word">{body}</text>
      <box flexGrow={1} />
      <text wrapMode="none">
        <span fg={t.error} attributes={TextAttributes.BOLD}>{` ${confirmLabel} `}</span>
        <span fg={t.subtle}>{" y / ⏎     "}</span>
        <span fg={t.muted}>{"Cancel"}</span>
        <span fg={t.subtle}>{" n / esc"}</span>
      </text>
    </Overlay>
  );
}

export function ModeModal() {
  const { ui, store, runtimes } = useApp();
  const t = useTheme();
  const { width } = useTerminalDimensions();
  const sel = selection({ ui, store });
  const modes = sel.agent?.availableModes ?? [];
  const items: ListItem[] = modes.map((m) => ({
    id: m.id,
    label: m.label,
    detail: m.description,
    hint: m.id === sel.agent?.currentModeId ? "current" : "",
    marker: { glyph: m.id === sel.agent?.currentModeId ? "●" : "○", color: m.id === sel.agent?.currentModeId ? t.accent : t.subtle },
  }));
  return (
    <Overlay title="Mode" width={64} height={Math.min(22, 6 + items.length * 2)} footer="⏎ switch · esc close">
      <SelectList
        items={items}
        filterable={false}
        initialId={sel.agent?.currentModeId ?? undefined}
        width={overlayInner(64, width)}
        height={items.length * 2}
        onCancel={() => ui.actions.closeModal()}
        onSelect={async (it) => {
          ui.actions.closeModal();
          try {
            await runtimes.get(sel.hostId!)!.setMode(sel.agentId!, it.id);
            ui.actions.toast(`Mode: ${it.label}`, "success");
          } catch (err) {
            ui.actions.toast(String(err instanceof Error ? err.message : err), "error");
          }
        }}
      />
    </Overlay>
  );
}

type ModelList = { id: string; label: string; description?: string; provider?: string }[];

/** Picks the row label: the upstream provider in front when the daemon lists one
 *  (e.g. "mistral/GLM-5.3" — the same pretty name can come from several providers). */
export function modelLabel(m: { label: string; provider?: string }): string {
  return m.provider ? `${m.provider}/${m.label}` : m.label;
}

export function ModelModal() {
  const { ui, store, runtimes } = useApp();
  const t = useTheme();
  const { width } = useTerminalDimensions();
  const sel = selection({ ui, store });
  const [models, setModels] = useState<ModelList | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!sel.agent || !sel.hostId) return;
    runtimes
      .get(sel.hostId)!
      .listModels(sel.agent.provider)
      .then((r) => setModels(normalizeModels(r)))
      .catch((e) => setError(String(e?.message ?? e)));
  }, []);
  useKeyboard((k) => {
    if (!models && k.name === "escape") ui.actions.closeModal();
  });
  const current = sel.agent?.model ?? undefined;
  return (
    <Overlay title={`Model · ${sel.agent?.provider ?? ""}`} width={64} height={20} footer="⏎ switch · esc close">
      {error ? (
        <text fg={t.error}>{error}</text>
      ) : !models ? (
        <Skeleton rows={6} width={overlayInner(64, width)} gap={0} />
      ) : (
        <SelectList
          items={models.map((m) => ({ id: m.id, label: modelLabel(m), detail: m.description, hint: m.id === current ? "current" : "", marker: { glyph: m.id === current ? "●" : "○", color: m.id === current ? t.accent : t.subtle } }))}
          initialId={current}
          width={overlayInner(64, width)}
          height={16}
          placeholder="Search models"
          onCancel={() => ui.actions.closeModal()}
          onSelect={async (it) => {
            ui.actions.closeModal();
            try {
              await runtimes.get(sel.hostId!)!.setModel(sel.agentId!, it.id);
              ui.actions.toast(`Model: ${it.label}`, "success");
            } catch (err) {
              ui.actions.toast(String(err instanceof Error ? err.message : err), "error");
            }
          }}
        />
      )}
    </Overlay>
  );
}

/** listModels payload → simple list (tolerates field-name differences across daemon versions). */
export function normalizeModels(r: unknown): ModelList {
  const raw = (r as { models?: unknown[] })?.models;
  const list = Array.isArray(raw) ? raw : Array.isArray(r) ? r : [];
  return (list as Record<string, unknown>[])
    .map((m) => {
      const id = String(m.id ?? m.modelId ?? m.value ?? "");
      // metadata.providerId names the upstream that serves this model (e.g.
      // "mistral" inside the opencode provider); ids like "openai/gpt-5" carry it in front.
      const meta = (m.metadata ?? {}) as Record<string, unknown>;
      const provider =
        typeof meta.providerId === "string" && meta.providerId
          ? meta.providerId
          : id.includes("/")
            ? id.slice(0, id.indexOf("/"))
            : undefined;
      return {
        id,
        label: String(m.label ?? m.name ?? m.displayName ?? m.id ?? ""),
        description: typeof m.description === "string" ? m.description : undefined,
        provider,
      };
    })
    .filter((m) => m.id);
}
