import { expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { AppRoot, createAppState } from "../src/app-root";
import type { HostRuntime } from "../src/paseo/host-runtime";
import { workspaceKey } from "../src/ui/sidebar/model";

test("sidebar archive targets the highlighted row; palette archive searches and confirms", async () => {
  const state = createAppState();
  state.store.actions.addHost({ id: "host", label: "Host", url: "ws://localhost/ws" });
  state.store.actions.setProjects("host", []);
  state.store.actions.setWorkspaces("host", [
    { id: "selected", projectId: "p", title: "Selected" },
    { id: "target", projectId: "p", title: "Cleanup target", workspaceKind: "worktree" },
  ] as never);
  state.ui.actions.selectWorkspace("host", "selected");
  state.ui.actions.setCursor(workspaceKey("host", "target"));
  const calls: string[] = [];
  state.runtimes.get = () => ({
    archiveWorkspace: async (id: string) => calls.push(id),
  }) as unknown as HostRuntime;
  const t = await testRender(<AppRoot state={state} />, { width: 96, height: 24 });
  const settle = async () => {
    await Bun.sleep(25);
    await t.renderOnce();
  };
  try {
    await settle();
    t.mockInput.pressKey("a");
    await settle();
    expect(state.ui.getState().modal).toMatchObject({ payload: { hostId: "host", workspaceId: "target" } });
    expect(t.captureCharFrame()).toContain("managed worktree");
    t.mockInput.pressEscape();
    await settle();
    expect(calls).toEqual([]);

    t.mockInput.pressKey("k", { ctrl: true });
    await settle();
    await t.mockInput.typeText("archive a workspace");
    await settle();
    t.mockInput.pressEnter();
    await settle();
    expect(state.ui.getState().modal).toMatchObject({ kind: "archiveWorkspace" });
    await t.mockInput.typeText("cleanup");
    await settle();
    t.mockInput.pressEnter();
    await settle();
    expect(state.ui.getState().modal).toMatchObject({ payload: { hostId: "host", workspaceId: "target" } });
    expect(calls).toEqual([]);
    t.mockInput.pressKey("y");
    await settle();
    expect(calls).toEqual(["target"]);
    expect(state.ui.getState().selectedWorkspace.host).toBe("selected");
  } finally {
    t.renderer.destroy();
  }
});
