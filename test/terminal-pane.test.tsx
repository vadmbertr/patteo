import { expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { createAppState, AppRoot } from "../src/app-root";
import { sanitizeSettings } from "../src/config/settings";
import type { HostRuntime } from "../src/paseo/host-runtime";

test("the terminal opens at half the previous chat width, receives input, and detaches when hidden", async () => {
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
    expect(t.renderer.root.findDescendantById("resize-terminal")!.x).toBe(69);
    expect(t.captureCharFrame()).toContain("shell ready");
    expect(attachments[0]).toMatchObject({ workspace: "w", command: "bash", cols: 28 });
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

test.each(["left", "right"] as const)("mouse dividers resize all panes with the explorer on the %s", async (panelSide) => {
  const state = createAppState({ settings: { panelSide } });
  state.store.actions.addHost({ id: "h", label: "Host", url: "ws://localhost/ws" });
  state.store.actions.setWorkspaces("h", [{ id: "w", title: "Workspace" }] as never);
  state.ui.actions.selectWorkspace("h", "w");
  state.ui.actions.openPanel("files");
  state.ui.actions.toggleTerminal();
  const sizes: number[] = [];
  state.runtimes.get = () => ({
    loadChanges: async () => {},
    listDir: async () => {},
    attachShell: async () => ({ write: () => 0, resize: (cols: number) => sizes.push(cols) }),
  }) as unknown as HostRuntime;
  const t = await testRender(<AppRoot state={state} />, { width: 200, height: 20 });
  const settle = async () => {
    await Bun.sleep(25);
    await t.renderOnce();
  };
  const x = (name: string) => t.renderer.root.findDescendantById(`resize-${name}`)!.x;
  const drag = async (name: string, to: number) => {
    await t.mockMouse.drag(x(name), 5, to, 5);
    await settle();
  };
  try {
    await settle();
    expect(x("terminal")).toBe(144);
    await drag("terminal", 99);
    expect(x("terminal")).toBe(99);
    expect(x("sidebar")).toBe(38);
    await drag("sidebar", 1);
    expect(x("sidebar")).toBe(28);

    const before = x("explorer");
    const grow = panelSide === "left" ? 1 : -1;
    await drag("explorer", before + grow * 10);
    expect(x("explorer")).toBe(before + grow * 10);
    await drag("explorer", grow === 1 ? 0 : 198);
    expect(x("explorer")).toBe(before);
    await drag("terminal", 1);
    expect(x("terminal")).toBe(90);
    expect(x("explorer")).toBeGreaterThan(x("sidebar"));
    await drag("terminal", 198);
    expect(x("terminal")).toBe(179);
    expect(sizes.at(-1)).toBe(18);
    t.mockInput.pressKey("F2");
    await settle();
    t.mockInput.pressKey("F2");
    await settle();
    expect(x("terminal")).toBe(179);
  } finally {
    t.renderer.destroy();
  }
});
