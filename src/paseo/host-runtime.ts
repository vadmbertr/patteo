/**
 * One HostRuntime per configured daemon. This (and the rest of src/paseo/) is the
 * only code that talks to @getpaseo/client, so protocol churn stays contained.
 */
import { createPaseoApi, type PaseoAgentCreateOptions, type PaseoApi } from "@getpaseo/client";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { AgentPermissionResponse } from "@getpaseo/protocol/agent-types";
import type { HostConfig } from "../config/hosts";
import { log } from "../log";
import { changesKey, timelineKey, type SessionStore } from "../stores/session";
import { effectiveMode, toCheckoutInfo, toDiffFiles, toPrState, type ChangesMode } from "./changes";
import { MAX_VIEW_BYTES, toDirEntries, toFileContent, type FileContent } from "./files";
import { applyStreamEvent, hydrateTimeline, prependOlder, type FetchedPage, type StreamEnvelope } from "./timeline";

export const SUPPORTED_DAEMON_MINOR = "0.16";
const TIMELINE_PAGE = 200;
const POLL_MS = 250;

type Unsub = () => void;

/**
 * The public SDK (PaseoApi) plus the low-level DaemonClient it wraps. The SDK's high-level
 * handles don't expose cancel / mode / model, which the CLI and Desktop get from DaemonClient.
 * This mirrors createPaseoClient() from @getpaseo/client (pinned version).
 */
type PaseoClient = PaseoApi & {
  daemon: DaemonClient;
  connect(): Promise<void>;
  close(): Promise<void>;
  getConnectionState(): ReturnType<DaemonClient["getConnectionState"]>;
};

type ClientConfig = Omit<ConstructorParameters<typeof DaemonClient>[0], "clientId" | "clientType"> & { clientId?: string };

function createClient(config: ClientConfig): PaseoClient {
  const daemon = new DaemonClient({ ...config, clientId: config.clientId ?? `patteo-${crypto.randomUUID()}`, clientType: "cli" });
  const api = createPaseoApi(daemon);
  return {
    ...api,
    daemon,
    connect: () => daemon.connect(),
    close: async () => {
      try {
        await api.dispose();
      } finally {
        await daemon.close();
      }
    },
    getConnectionState: () => daemon.getConnectionState(),
  };
}

interface OpenTimeline {
  refs: number;
  unsubscribe: Unsub | null;
  refetching: boolean;
}

export class HostRuntime {
  readonly id: string;
  private client: PaseoClient | null = null;
  private disposed = false;
  private wired = false;
  private lastStatus: string = "idle";
  private everConnected = false;
  private poll: ReturnType<typeof setInterval> | null = null;
  private lastSig = "";
  private cleanups: Unsub[] = [];
  private timelines = new Map<string, OpenTimeline>();

  constructor(
    readonly config: HostConfig,
    private readonly store: SessionStore,
  ) {
    this.id = config.id;
  }

  get api(): PaseoClient {
    if (!this.client) throw new Error(`Host ${this.id} not started`);
    return this.client;
  }

  start() {
    if (this.client || this.disposed) return;
    this.client = createClient({
      url: this.config.url,
      password: this.config.password,
      appVersion: "patteo",
      logger: log,
      connectTimeoutMs: 5000,
      reconnect: { enabled: true, baseDelayMs: 500, maxDelayMs: 10_000 },
    });
    this.poll = setInterval(() => this.observeConnection(), POLL_MS);
    void this.connect();
  }

  private async connect() {
    if (this.disposed || !this.client) return;
    this.store.actions.setConnection(this.id, { status: "connecting", attempt: 1 });
    try {
      // While the daemon is unreachable the SDK retries internally and this stays pending;
      // progress is mirrored from getConnectionState() by observeConnection().
      await this.client.connect();
      this.observeConnection();
    } catch (err) {
      log.warn({ host: this.id, err: String(err) }, "connect rejected");
      this.store.actions.setConnection(this.id, { status: "disconnected", error: errorText(err) });
    }
  }

  /** Mirrors SDK connection state into the store and reacts to (re)connects. */
  private observeConnection() {
    if (!this.client) return;
    const state = this.client.getConnectionState() as ReturnType<PaseoClient["getConnectionState"]> & {
      reason?: string;
      nextRetryAt?: string;
    };
    const sig = JSON.stringify(state);
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    const prev = this.lastStatus;
    this.lastStatus = state.status;
    switch (state.status) {
      case "connecting":
        this.store.actions.setConnection(this.id, { status: "connecting", attempt: state.attempt });
        break;
      case "connected":
        if (prev === "connected") break;
        this.store.actions.setConnection(this.id, { status: "connected" });
        void this.onConnected(this.everConnected);
        this.everConnected = true;
        break;
      case "disconnected":
        this.store.actions.setConnection(this.id, {
          status: "disconnected",
          error: state.reason,
          retryAt: state.nextRetryAt ? Date.parse(state.nextRetryAt) : undefined,
        });
        break;
    }
  }

  private async onConnected(isReconnect: boolean) {
    void this.fetchServerInfo();
    try {
      if (!this.wired) {
        this.wired = true;
        await this.wireSubscriptions();
      } else if (isReconnect) {
        // Owned agent/workspace subscriptions restore themselves; projects and timelines don't.
        await this.refreshProjects();
        for (const agentId of this.timelines.keys()) void this.refetchTimeline(agentId);
      }
    } catch (err) {
      log.error({ host: this.id, err: String(err) }, "wiring subscriptions failed");
    }
  }

  private async fetchServerInfo() {
    try {
      const httpUrl = this.config.url.replace(/^ws/, "http").replace(/\/ws\/?$/, "/api/status");
      const res = await fetch(httpUrl, { signal: AbortSignal.timeout(3000) });
      const info = (await res.json()) as { serverId?: string; version?: string; hostname?: string };
      this.store.actions.setServerInfo(this.id, info);
    } catch {
      // Remote/relay hosts may not expose HTTP status; version stays unknown.
    }
  }

  private async refreshProjects() {
    const res = await this.api.projects.list();
    this.store.actions.setProjects(this.id, res.projects);
  }

  private async wireSubscriptions() {
    const a = this.store.actions;
    const api = this.api;

    const agents = await api.agents.list({ subscribe: {} });
    a.setAgents(this.id, agents.entries.map((e) => e.agent));
    this.cleanups.push(
      agents.subscription.subscribe({
        snapshot: (s) => a.setAgents(this.id, s.entries.map((e) => e.agent)),
        update: (m) => {
          if (m.type !== "agent_update") return;
          if (m.payload.kind === "upsert") a.upsertAgent(this.id, m.payload.agent);
          else a.removeAgent(this.id, m.payload.agentId);
        },
      }),
    );

    const workspaces = await api.workspaces.list({ subscribe: {} });
    a.setWorkspaces(this.id, workspaces.entries);
    this.cleanups.push(
      workspaces.subscription.subscribe({
        snapshot: (s) => a.setWorkspaces(this.id, s.entries),
        update: (m) => {
          if (m.type !== "workspace_update") return;
          if (m.payload.kind === "upsert") a.upsertWorkspace(this.id, m.payload.workspace);
          else a.removeWorkspace(this.id, m.payload.id);
        },
      }),
    );

    await this.refreshProjects();
    const events = api.observeEvents(["project.update"]);
    this.cleanups.push(
      events.subscribe({
        snapshot: () => {},
        update: (m) => {
          if (m.type !== "project.update") return;
          if (m.payload.kind === "upsert") a.upsertProject(this.id, m.payload.project);
          else a.removeProject(this.id, m.payload.projectId);
        },
      }),
    );
    this.cleanups.push(() => void agents.subscription.release());
    this.cleanups.push(() => void workspaces.subscription.release());
    this.cleanups.push(() => void events.release());
  }

  /** Ref-counted live timeline for an agent. Returns a release function. */
  openTimeline(agentId: string): Unsub {
    let entry = this.timelines.get(agentId);
    if (entry) {
      entry.refs++;
    } else {
      entry = { refs: 1, unsubscribe: null, refetching: false };
      this.timelines.set(agentId, entry);
      const key = timelineKey(this.id, agentId);
      const sub = this.api.agents.ref(agentId).timeline.subscribe((ev) => {
        this.store.actions.updateTimeline(key, (t) => applyStreamEvent(t, ev as StreamEnvelope));
        if (this.store.getState().timelines[key]?.stale) void this.refetchTimeline(agentId);
      });
      entry.unsubscribe = sub;
      void this.refetchTimeline(agentId);
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const e = this.timelines.get(agentId);
      if (!e || --e.refs > 0) return;
      e.unsubscribe?.();
      this.timelines.delete(agentId);
    };
  }

  async refetchTimeline(agentId: string) {
    const entry = this.timelines.get(agentId);
    if (!entry || entry.refetching) return;
    entry.refetching = true;
    const key = timelineKey(this.id, agentId);
    try {
      const page = await this.api.agents
        .ref(agentId)
        .timeline.refetch({ direction: "tail", limit: TIMELINE_PAGE, wholeTurns: true });
      this.store.actions.updateTimeline(key, (t) => hydrateTimeline(t, page as FetchedPage));
    } catch (err) {
      this.store.actions.updateTimeline(key, (t) => ({ ...t, loading: false, lastError: errorText(err) }));
    } finally {
      entry.refetching = false;
    }
  }

  // ── Agent actions ────────────────────────────────────────────────────────

  send(agentId: string, text: string) {
    return this.api.agents.ref(agentId).send(text);
  }

  cancel(agentId: string) {
    return this.api.daemon.cancelAgent(agentId);
  }

  setMode(agentId: string, modeId: string) {
    return this.api.daemon.setAgentMode(agentId, modeId);
  }

  setModel(agentId: string, modelId: string | null) {
    return this.api.daemon.setAgentModel(agentId, modelId);
  }

  archive(agentId: string) {
    return this.api.agents.ref(agentId).archive();
  }

  /** Deletes the agent for good (stopping it if it is running); archive is the undoable version. */
  delete(agentId: string) {
    return this.api.daemon.deleteAgent(agentId);
  }

  respondToPermission(agentId: string, requestId: string, response: AgentPermissionResponse) {
    return this.api.agents.ref(agentId).respondToPermission({ requestId, response });
  }

  /** Creates an agent inside a workspace (falls back to its directory). */
  /** In a workspace the agent runs there, so `cwd` is only needed when no workspace is given. */
  async createAgent(opts: { workspaceId?: string; cwd?: string } & Omit<PaseoAgentCreateOptions, "cwd">) {
    const { workspaceId, cwd, ...rest } = opts;
    if (workspaceId) return this.api.workspaces.ref(workspaceId).agents.create(rest);
    if (!cwd) throw new Error("createAgent needs a workspace or a cwd");
    return this.api.agents.create({ ...rest, cwd });
  }

  /**
   * Opens a directory as a workspace (Desktop's "Add folder"). `create` makes the
   * directory first when it doesn't exist yet.
   */
  async openFolder(cwd: string, create = false) {
    try {
      const handle = await this.api.workspaces.open({ cwd });
      await this.refreshProjects();
      return handle;
    } catch (err) {
      if (!create) throw err;
      const cut = cwd.lastIndexOf("/");
      if (cut <= 0) throw err;
      await this.api.daemon.createProjectDirectory({ parentPath: cwd.slice(0, cut) || "/", name: cwd.slice(cut + 1) });
      const handle = await this.api.workspaces.open({ cwd });
      await this.refreshProjects();
      return handle;
    }
  }

  /** The directory the workspace's checkout lives in. */
  private workspaceCwd(workspaceId: string): string | null {
    const ws = this.store.getState().hosts[this.id]?.workspaces[workspaceId];
    return ws?.workspaceDirectory ?? ws?.projectRootPath ?? null;
  }

  /**
   * Loads the workspace's diff for the current comparison mode and, on request, its
   * pull-request state and branch facts. The diff is cheap (git on the daemon); PR state
   * hits the forge API, so callers ask for it on open and on refresh, not on every poll.
   * With no explicit mode, a branch that has a PR is compared against its base.
   */
  async loadChanges(workspaceId: string, opts: { pr?: boolean; mode?: ChangesMode } = {}) {
    const key = changesKey(this.id, workspaceId);
    const cwd = this.workspaceCwd(workspaceId);
    const a = this.store.actions;
    if (!cwd) {
      a.updateChanges(key, (c) => ({ ...c, loading: false, error: "This workspace has no directory" }));
      return;
    }
    if (opts.mode) a.updateChanges(key, (c) => ({ ...c, mode: opts.mode! }));
    a.updateChanges(key, (c) => ({ ...c, loading: true, cwd, ...(opts.pr ? { prLoading: true } : {}) }));
    const readDiff = async (mode: ChangesMode) => toDiffFiles((await this.api.daemon.getCheckoutDiff(cwd, { mode })) as never);
    const current = () => this.store.getState().changes[key]!;
    try {
      const [diff, pr, info] = await Promise.all([
        readDiff(effectiveMode(current())),
        opts.pr ? this.api.daemon.checkoutPrStatus(cwd).then((p) => toPrState(p as never)).catch(() => null) : Promise.resolve(undefined),
        opts.pr ? this.api.daemon.getCheckoutStatus(cwd).then((p) => toCheckoutInfo(p as never)).catch(() => null) : Promise.resolve(undefined),
      ]);
      a.updateChanges(key, (c) => ({
        ...c,
        cwd,
        loading: false,
        files: diff.files,
        error: diff.error,
        diffTooLarge: diff.diffTooLarge,
        fetchedAt: Date.now(),
        ...(opts.pr ? { pr: pr ?? null, prLoading: false, prLoaded: true, checkout: info ?? c.checkout } : {}),
      }));
      // A PR just appeared and the user hasn't chosen a comparison: show the PR's changes.
      if (opts.pr && pr && current().mode === null) {
        const again = await readDiff("base");
        a.updateChanges(key, (c) => ({ ...c, files: again.files, error: again.error, diffTooLarge: again.diffTooLarge }));
      }
    } catch (err) {
      a.updateChanges(key, (c) => ({ ...c, loading: false, prLoading: false, error: errorText(err) }));
    }
  }

  /** Lists one directory of the workspace ("" is the root) into the Files tab's cache. */
  async listDir(workspaceId: string, path = "") {
    const key = changesKey(this.id, workspaceId);
    const cwd = this.workspaceCwd(workspaceId);
    const a = this.store.actions;
    const put = (listing: { entries: ReturnType<typeof toDirEntries>; loading: boolean; error: string | null }) =>
      a.updateFiles(key, (f) => ({ ...f, cwd, listings: { ...f.listings, [path]: listing } }));
    const prev = this.store.getState().files[key]?.listings[path];
    if (!cwd) return put({ entries: [], loading: false, error: "This workspace has no directory" });
    put({ entries: prev?.entries ?? [], loading: true, error: null });
    try {
      const dir = await this.api.daemon.listDirectory(cwd, path || ".");
      put({ entries: toDirEntries(dir as never), loading: false, error: null });
    } catch (err) {
      put({ entries: prev?.entries ?? [], loading: false, error: errorText(err) });
    }
  }

  /** Reads a file for the viewer; large files come back truncated. */
  async readFile(workspaceId: string, path: string): Promise<FileContent> {
    const cwd = this.workspaceCwd(workspaceId);
    if (!cwd) return { kind: "error", message: "This workspace has no directory" };
    try {
      return toFileContent((await this.api.daemon.readFile(cwd, path, undefined, MAX_VIEW_BYTES)) as never);
    } catch (err) {
      return { kind: "error", message: errorText(err) };
    }
  }

  /** Creates a pull request for the workspace's branch; the daemon derives title and body. */
  async createPr(workspaceId: string) {
    const cwd = this.workspaceCwd(workspaceId);
    if (!cwd) throw new Error("This workspace has no directory");
    const payload = await this.api.daemon.checkoutPrCreate(cwd, {});
    if (payload.error) throw new Error(payload.error.message);
    return { url: payload.url, number: payload.number };
  }

  /** Directory names inside an absolute path, for path completion (daemon-side, so remote hosts work). */
  async listDirs(path: string): Promise<string[]> {
    const dir = await this.api.daemon.listDirectory("/", path);
    return dir.entries.filter((e) => e.kind === "directory").map((e) => e.name);
  }

  providers() {
    return this.api.providers.snapshot();
  }

  /**
   * Forks an agent's conversation into a new agent in the same workspace, the way
   * Desktop's "fork in new tab" does: the daemon projects the timeline into a
   * chat-history attachment, and the new agent starts with it.
   */
  async fork(agentId: string): Promise<string> {
    const agent = this.store.getState().hosts[this.id]?.agents[agentId];
    if (!agent) throw new Error("Agent not found");
    if (!agent.workspaceId) throw new Error("This agent has no workspace to fork into");
    const payload = await this.api.daemon.buildAgentForkContext(agentId);
    if (!payload.attachment) throw new Error("The daemon returned no conversation to fork");
    const handle = await this.api.workspaces.ref(agent.workspaceId).agents.create({
      config: {
        // The high-level create takes "provider/model" in one field.
        provider: agent.model ? `${agent.provider}/${agent.model}` : agent.provider,
        ...(agent.currentModeId ? { modeId: agent.currentModeId } : {}),
        ...(agent.thinkingOptionId ? { thinkingOptionId: agent.thinkingOptionId } : {}),
        ...(agent.options ? { options: agent.options } : {}),
      },
      attachments: [payload.attachment],
    });
    return handle.id;
  }

  listModels(provider: string) {
    return this.api.providers.listModels(provider);
  }

  /** Pages backwards from the oldest loaded entry. */
  async loadOlder(agentId: string) {
    const key = timelineKey(this.id, agentId);
    const t = this.store.getState().timelines[key];
    if (!t || !t.hasOlder || t.loadingOlder || !t.startCursor) return;
    this.store.actions.updateTimeline(key, (s) => ({ ...s, loadingOlder: true }));
    try {
      const page = await this.api.agents
        .ref(agentId)
        .timeline.refetch({ direction: "before", cursor: t.startCursor as never, limit: TIMELINE_PAGE, wholeTurns: true });
      this.store.actions.updateTimeline(key, (s) => prependOlder(s, page as FetchedPage));
      if (this.store.getState().timelines[key]?.stale) void this.refetchTimeline(agentId);
    } catch (err) {
      this.store.actions.updateTimeline(key, (s) => ({ ...s, loadingOlder: false, lastError: errorText(err) }));
    }
  }

  async dispose() {
    this.disposed = true;
    if (this.poll) clearInterval(this.poll);
    for (const t of this.timelines.values()) t.unsubscribe?.();
    this.timelines.clear();
    for (const c of this.cleanups.splice(0)) c();
    await this.client?.close().catch(() => {});
    this.client = null;
  }
}

export function isVersionSkewed(version: string | null): boolean {
  if (!version) return false;
  return !version.startsWith(SUPPORTED_DAEMON_MINOR + ".");
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
