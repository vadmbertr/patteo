import { useTerminalDimensions } from "@opentui/react";
import { confirmArchiveWorkspace } from "../../keyboard/commands";
import { useActiveHost, useApp } from "../../stores/context";
import { workspaceLabel } from "../sidebar/model";
import { Overlay, overlayInner } from "./Overlay";
import { SelectList } from "./SelectList";

export function ArchiveWorkspaceModal() {
  const ctx = useApp();
  const host = useActiveHost();
  const { width, height } = useTerminalDimensions();
  const modalHeight = Math.min(20, height - 2);
  const items = Object.values(host?.workspaces ?? {})
    .filter((w) => !w.archivingAt)
    .map((w) => ({
      id: w.id,
      label: workspaceLabel(w),
      detail: [w.projectDisplayName, w.workspaceDirectory].filter(Boolean).join(" · "),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return (
    <Overlay title="Archive a workspace" width={64} height={modalHeight} footer="⏎ select · esc close">
      <SelectList
        items={items}
        width={overlayInner(64, width)}
        height={modalHeight - 2}
        placeholder="Search workspaces"
        onCancel={() => ctx.ui.actions.closeModal()}
        onSelect={(item) => {
          ctx.ui.actions.closeModal();
          if (host) confirmArchiveWorkspace(ctx, host.config.id, item.id);
        }}
      />
    </Overlay>
  );
}
