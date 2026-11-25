import { expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { createAppState, AppRoot } from "../src/app-root";
import { sanitizeSettings } from "../src/config/settings";
import type { HostRuntime } from "../src/paseo/host-runtime";

test("the terminal opens on the right half, receives input, and detaches when hidden", async () => {
  const state = createAppState({ settings: sanitizeSettings({ terminalShell: " bash " }) });
  state.store.actions.addHost({ id: "h", label: "Host", url: "ws://localhost/ws" });
  state.store.actions.setWorkspaces("h", [{ id: "w", title: "Workspace" }] as never);
  state.ui.actions.selectWorkspace("h", "w");
  state.ui.actions.setFocus("main");
  const attachments: { workspace: string; command?: string; cols: number; signal: AbortSignal }[] = [];
  const input: string[] = [];
  let quits = 0;
  const attachShell: HostRuntime["attachShell"] = async (workspace, command, size, write, _end, signal) => {
    attachments.push({ workspace, command, cols: size.cols, signal });
    write({ terminalId: "test", subscriptionId: "test", type: "output", data: new TextEncoder().encode("shell ready") });
    return { write: (text) => input.push(text), resize: () => {} };
  };
  state.runtimes.get = () => ({ attachShell }) as HostRuntime;
  const t = await testRender(<AppRoot state={state} onQuit={() => quits++} />, { width: 100, height: 20, exitOnCtrlC: false });
  const settle = async () => {
    await Bun.sleep(25);
    await t.renderOnce();
  };
  try {
    await settle();
    t.mockInput.pressKey("F2");
    await settle();
    expect(t.captureCharFrame().split("\n")[0]!.indexOf("Terminal")).toBeGreaterThan(49);
    expect(t.captureCharFrame()).toContain("shell ready");
    expect(attachments[0]).toMatchObject({ workspace: "w", command: "bash", cols: 48 });
    t.mockInput.pressKey("q");
    t.mockInput.pressCtrlC();
    expect(input.join("")).toBe("q\x03");
    expect(quits).toBe(0);
    t.mockInput.pressKey("F2");
    await settle();
    expect(attachments[0]!.signal.aborted).toBe(true);
    expect(state.ui.getState().focus).toBe("main");
    expect(t.captureCharFrame()).not.toContain("shell ready");
    t.mockInput.pressKey("F2");
    await settle();
    expect(attachments).toHaveLength(2);
    expect(t.captureCharFrame()).toContain("shell ready");
  } finally {
    t.renderer.destroy();
  }
});
