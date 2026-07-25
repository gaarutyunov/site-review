import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { CommentUpsert } from "@site-review/shared";
import { CommentStore } from "../store.js";
import { createApp } from "../http.js";
import { GithubStore } from "./store.js";
import { DeviceFlow } from "./device-flow.js";
import type { GithubClient } from "./client.js";

const PAGE = "https://gaarutyunov.github.io/site-review/pr-preview/pr-3/";
const ORIGIN = "https://gaarutyunov.github.io";
const TOKEN = "ghu_supersecret";

class FakeGithubClient implements GithubClient {
  created: string[] = [];
  prNumbers = new Set([3]);
  async whoami() {
    return "gaarutyunov";
  }
  async listRepos() {
    return [
      {
        owner: "gaarutyunov",
        repo: "site-review",
        defaultBranch: "main",
        private: false,
      },
    ];
  }
  async prExists(_o: string, _r: string, number: number) {
    return this.prNumbers.has(number);
  }
  async listOpenIssues() {
    return [{ number: 7, title: "Add integration with github", url: "https://gh/7" }];
  }
  async createPrReview(_o: string, _r: string, number: number) {
    this.created.push(`review:${number}`);
    return `https://github.com/gaarutyunov/site-review/pull/${number}#review-1`;
  }
  async createIssueComment(_o: string, _r: string, number: number) {
    this.created.push(`issue-comment:${number}`);
    return `https://github.com/gaarutyunov/site-review/issues/${number}#c1`;
  }
  async createIssue(_o: string, _r: string, title: string) {
    this.created.push(`issue:${title}`);
    return { number: 42, url: "https://github.com/gaarutyunov/site-review/issues/42" };
  }
}

function upsert(id: string, over: Partial<CommentUpsert> = {}): CommentUpsert {
  return {
    id,
    pageUrl: PAGE,
    pageTitle: "Site Review",
    text: `fix it (${id})`,
    status: "open",
    targets: [{ slug: "dancing-gorilla", cssSelector: "button.cta" }],
    ...over,
  };
}

describe("/github routes", () => {
  let comments: CommentStore;
  let github: GithubStore;
  let client: FakeGithubClient;
  let server: Server;
  let base: string;

  function start(opts: { configured?: boolean; deviceFlow?: DeviceFlow } = {}) {
    const app = createApp(comments, {
      github,
      config: opts.configured === false ? null : { clientId: "Iv1.test" },
      clientFor: () => client,
      deviceFlow: opts.deviceFlow,
    });
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  const get = (p: string) => fetch(`${base}${p}`);
  const post = (p: string, body?: unknown) =>
    fetch(`${base}${p}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });

  beforeEach(() => {
    comments = new CommentStore(":memory:");
    github = new GithubStore(comments.database);
    client = new FakeGithubClient();
  });

  afterEach(() => {
    server?.close();
  });

  // --- connection --------------------------------------------------------

  it("reports not configured when no client id is set", async () => {
    start({ configured: false });
    const status = await (await get("/github/status")).json();
    expect(status).toMatchObject({ configured: false, authenticated: false });

    const connect = await post("/github/connect");
    expect(connect.status).toBe(503);
    expect((await connect.json()).error).toBe("github not configured");
  });

  it("starts a device flow and reports the connection once authorized", async () => {
    let authorized: (token: string) => void = () => {};
    const flow = new DeviceFlow("Iv1.test", github, {
      authorize: (_id, onVerification) =>
        new Promise<string>((resolve) => {
          onVerification({
            device_code: "dev",
            user_code: "WDJB-MJHT",
            verification_uri: "https://github.com/login/device",
            expires_in: 900,
            interval: 5,
          });
          authorized = resolve;
        }),
      clientFor: () => client,
    });
    start({ deviceFlow: flow });

    const code = await (await post("/github/connect")).json();
    expect(code).toMatchObject({
      userCode: "WDJB-MJHT",
      verificationUri: "https://github.com/login/device",
    });
    expect(await (await get("/github/status")).json()).toMatchObject({
      authenticated: false,
      pending: true,
    });

    authorized(TOKEN);
    await new Promise((r) => setTimeout(r, 10));

    const status = await (await get("/github/status")).json();
    expect(status).toMatchObject({ authenticated: true, login: "gaarutyunov" });
    expect(JSON.stringify(status)).not.toContain(TOKEN);
    expect(github.getAuth()?.accessToken).toBe(TOKEN);
  });

  it("reports a reason and stores no token when authorization is denied", async () => {
    const flow = new DeviceFlow("Iv1.test", github, {
      authorize: (_id, onVerification) =>
        new Promise<string>((_resolve, reject) => {
          onVerification({
            device_code: "dev",
            user_code: "WDJB-MJHT",
            verification_uri: "https://github.com/login/device",
            expires_in: 900,
            interval: 5,
          });
          setTimeout(() => reject(new Error("access_denied")), 1);
        }),
      clientFor: () => client,
    });
    start({ deviceFlow: flow });

    await post("/github/connect");
    await new Promise((r) => setTimeout(r, 20));

    const status = await (await get("/github/status")).json();
    expect(status).toMatchObject({
      authenticated: false,
      reason: "authorization denied",
    });
    expect(github.getAuth()).toBeUndefined();
  });

  it("disconnects and forgets the token", async () => {
    github.setAuth({ login: "gaarutyunov", accessToken: TOKEN });
    start();
    expect(await (await post("/github/disconnect")).json()).toMatchObject({
      authenticated: false,
    });
    expect(github.getAuth()).toBeUndefined();
    expect(await (await get("/github/status")).json()).toMatchObject({
      authenticated: false,
    });
  });

  // --- repos / bindings --------------------------------------------------

  it("refuses to list repos when unauthenticated", async () => {
    start();
    const res = await get("/github/repos");
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("unauthenticated");
    expect(body.repos).toBeUndefined();
  });

  it("lists repos when authenticated, without leaking the token", async () => {
    github.setAuth({ login: "gaarutyunov", accessToken: TOKEN });
    start();
    const text = await (await get("/github/repos")).text();
    expect(JSON.parse(text).repos[0]).toMatchObject({ repo: "site-review" });
    expect(text).not.toContain(TOKEN);
  });

  it("binds an origin to a repo, remembers it, and clears it", async () => {
    start();
    const bound = await (
      await post("/github/bind", {
        pageUrl: PAGE,
        owner: "gaarutyunov",
        repo: "site-review",
      })
    ).json();
    expect(bound.binding).toMatchObject({ origin: ORIGIN, repo: "site-review" });

    // A different page on the same origin resolves to the same binding.
    const other = `${ORIGIN}/site-review/docs/`;
    const got = await (
      await get(`/github/binding?pageUrl=${encodeURIComponent(other)}`)
    ).json();
    expect(got.binding).toMatchObject({ repo: "site-review" });

    const del = await fetch(
      `${base}/github/binding?pageUrl=${encodeURIComponent(PAGE)}`,
      { method: "DELETE" },
    );
    expect(await del.json()).toEqual({ deleted: true });
    expect(
      (await (await get(`/github/binding?pageUrl=${encodeURIComponent(PAGE)}`)).json())
        .binding,
    ).toBeNull();
  });

  // --- detection ---------------------------------------------------------

  it("detects repo candidates from the page and the PR from the URL", async () => {
    github.setAuth({ login: "gaarutyunov", accessToken: TOKEN });
    github.setBinding({ origin: ORIGIN, owner: "gaarutyunov", repo: "site-review" });
    start();

    const res = await (
      await post("/github/detect", {
        pageUrl: PAGE,
        links: [
          "https://github.com/gaarutyunov/site-review",
          "https://github.com/features/actions",
        ],
      })
    ).json();

    expect(res.repoCandidates).toHaveLength(1);
    expect(res.repoCandidates[0]).toMatchObject({ repo: "site-review" });
    expect(res.detectedPr).toMatchObject({ number: 3 });
    expect(res.target).toEqual({ kind: "pr", number: 3 });
  });

  it("falls back to issue mode when the detected PR does not exist", async () => {
    github.setAuth({ login: "gaarutyunov", accessToken: TOKEN });
    github.setBinding({ origin: ORIGIN, owner: "gaarutyunov", repo: "site-review" });
    client.prNumbers.clear();
    start();

    const res = await (
      await post("/github/detect", { pageUrl: PAGE, links: [] })
    ).json();
    expect(res.detectedPr).toMatchObject({ number: 3 });
    expect(res.prUnavailable).toBe(true);
    expect(res.target).toEqual({ kind: "issue-new" });
  });

  it("serves the open-issue picker for the bound repo", async () => {
    github.setAuth({ login: "gaarutyunov", accessToken: TOKEN });
    github.setBinding({ origin: ORIGIN, owner: "gaarutyunov", repo: "site-review" });
    start();
    const res = await (
      await get(`/github/issues?pageUrl=${encodeURIComponent(PAGE)}`)
    ).json();
    expect(res.issues[0]).toMatchObject({ number: 7 });
  });

  // --- sync --------------------------------------------------------------

  it("refuses to sync when unauthenticated and creates no GitHub content", async () => {
    comments.upsert(upsert("jumping-koala"));
    start();
    const res = await post("/github/sync", { pageUrl: PAGE });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthenticated");
    expect(client.created).toEqual([]);
  });

  it("refuses to sync a page with no connected repository", async () => {
    github.setAuth({ login: "gaarutyunov", accessToken: TOKEN });
    comments.upsert(upsert("jumping-koala"));
    start();
    const res = await post("/github/sync", { pageUrl: PAGE });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("no repository connected");
    expect(client.created).toEqual([]);
  });

  it("syncs the page's open comments to the detected PR", async () => {
    github.setAuth({ login: "gaarutyunov", accessToken: TOKEN });
    github.setBinding({ origin: ORIGIN, owner: "gaarutyunov", repo: "site-review" });
    comments.upsert(upsert("jumping-koala"));
    comments.upsert(upsert("sleepy-otter", { status: "resolved" }));
    start();

    const text = await (await post("/github/sync", { pageUrl: PAGE })).text();
    const res = JSON.parse(text);
    expect(res).toMatchObject({ synced: 1, skipped: 0 });
    expect(res.target).toEqual({ kind: "pr", number: 3 });
    expect(client.created).toEqual(["review:3"]);
    expect(text).not.toContain(TOKEN);

    // Re-syncing the untouched page posts nothing more.
    const again = await (await post("/github/sync", { pageUrl: PAGE })).json();
    expect(again).toMatchObject({ synced: 0, skipped: 1 });
    expect(client.created).toEqual(["review:3"]);
  });

  it("reports nothing to sync when the page has no open comments", async () => {
    github.setAuth({ login: "gaarutyunov", accessToken: TOKEN });
    github.setBinding({ origin: ORIGIN, owner: "gaarutyunov", repo: "site-review" });
    start();
    const res = await (await post("/github/sync", { pageUrl: PAGE })).json();
    expect(res).toMatchObject({ synced: 0, skipped: 0, links: [] });
    expect(client.created).toEqual([]);
  });

  it("creates a new issue when the client asks for one", async () => {
    github.setAuth({ login: "gaarutyunov", accessToken: TOKEN });
    github.setBinding({ origin: ORIGIN, owner: "gaarutyunov", repo: "site-review" });
    comments.upsert(upsert("jumping-koala"));
    start();
    const res = await (
      await post("/github/sync", {
        pageUrl: PAGE,
        pageTitle: "Site Review",
        target: { kind: "issue-new", title: "Review findings" },
      })
    ).json();
    expect(client.created).toEqual(["issue:Review findings"]);
    expect(res.links[0].url).toContain("/issues/42");
  });

  it("rejects a malformed target", async () => {
    github.setAuth({ login: "gaarutyunov", accessToken: TOKEN });
    github.setBinding({ origin: ORIGIN, owner: "gaarutyunov", repo: "site-review" });
    comments.upsert(upsert("jumping-koala"));
    client.prNumbers.clear();
    start();
    // An unusable target falls back to detection rather than being trusted.
    const res = await (
      await post("/github/sync", { pageUrl: PAGE, target: { kind: "pr" } })
    ).json();
    expect(res.target).toEqual({ kind: "issue-new" });
    expect(client.created).toEqual(["issue:Site Review: " + PAGE]);
  });
});
