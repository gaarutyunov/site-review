import { Router, type Request, type Response } from "express";
import {
  normalizeUrl,
  type DetectionResult,
  type GithubConnectionStatus,
  type SyncTarget,
} from "@site-review/shared";
import type { CommentStore } from "../store.js";
import { githubConfig, type GithubConfig } from "./config.js";
import { OctokitGithubClient, type GithubClient } from "./client.js";
import { DeviceFlow } from "./device-flow.js";
import { GithubStore } from "./store.js";
import { extractRepoCandidates, resolveSyncTarget } from "./detect.js";
import { syncComments } from "./sync.js";

export interface GithubRoutesDeps {
  comments: CommentStore;
  github: GithubStore;
  /** Absent → `/github/*` reports "not configured" (design D7). */
  config?: GithubConfig | null;
  /** Overridable for tests; defaults to a token-authenticated Octokit. */
  clientFor?: (token: string) => GithubClient;
  /** Overridable for tests; defaults to the real OAuth device flow. */
  deviceFlow?: DeviceFlow;
}

/** The origin a binding is keyed by — page URLs vary, origins don't. */
function originOf(pageUrl: string): string {
  try {
    return new URL(pageUrl).origin;
  } catch {
    return normalizeUrl(pageUrl);
  }
}

const NOT_CONFIGURED = {
  error: "github not configured",
  detail:
    "Set GITHUB_APP_CLIENT_ID (see the README's Connect to GitHub section) and restart the server.",
};

const UNAUTHENTICATED = { error: "unauthenticated", detail: "Connect GitHub first." };

/**
 * The `/github/*` REST surface the extension drives (design D6). Every response
 * is built from non-token columns — the stored access token is only ever read
 * to construct an API client, never serialized (github-connection: "Token
 * confidentiality").
 */
export function githubRouter(deps: GithubRoutesDeps): Router {
  const router = Router();
  const config = deps.config === undefined ? githubConfig() : deps.config;
  const clientFor =
    deps.clientFor ?? ((token: string) => new OctokitGithubClient(token));
  const flow =
    deps.deviceFlow ??
    (config ? new DeviceFlow(config.clientId, deps.github, { clientFor }) : null);

  /** Resolve an authenticated client, or answer 401 and return null. */
  function authedClient(res: Response): GithubClient | null {
    const auth = deps.github.getAuth();
    if (!auth) {
      res.status(401).json(UNAUTHENTICATED);
      return null;
    }
    return clientFor(auth.accessToken);
  }

  function requireConfig(res: Response): boolean {
    if (!config || !flow) {
      res.status(503).json(NOT_CONFIGURED);
      return false;
    }
    return true;
  }

  // --- connection --------------------------------------------------------

  router.post("/connect", async (_req: Request, res: Response) => {
    if (!requireConfig(res)) return;
    try {
      const code = await flow!.start();
      res.json(code);
    } catch (e) {
      res.status(502).json({
        error: "device flow failed",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  });

  router.get("/status", (_req: Request, res: Response) => {
    const login = deps.github.getLogin();
    const status: GithubConnectionStatus = {
      configured: Boolean(config),
      authenticated: Boolean(login),
      ...(login ? { login } : {}),
      ...(flow?.isPending() ? { pending: true } : {}),
      ...(!login && flow?.error() ? { reason: flow.error()! } : {}),
    };
    res.json(status);
  });

  router.post("/disconnect", (_req: Request, res: Response) => {
    deps.github.clearAuth();
    flow?.clearError();
    res.json({ authenticated: false, configured: Boolean(config) });
  });

  // --- repositories and bindings ----------------------------------------

  router.get("/repos", async (_req: Request, res: Response) => {
    const client = authedClient(res);
    if (!client) return;
    try {
      res.json({ repos: await client.listRepos() });
    } catch (e) {
      res.status(502).json({ error: "github request failed", detail: message(e) });
    }
  });

  router.post("/bind", (req: Request, res: Response) => {
    const { origin, pageUrl, owner, repo, defaultBranch } = req.body ?? {};
    const key = origin ?? (pageUrl ? originOf(pageUrl) : undefined);
    if (!key || !owner || !repo) {
      return res
        .status(400)
        .json({ error: "origin (or pageUrl), owner and repo are required" });
    }
    res.json({
      binding: deps.github.setBinding({ origin: key, owner, repo, defaultBranch }),
    });
  });

  router.get("/binding", (req: Request, res: Response) => {
    const raw = (req.query.origin ?? req.query.pageUrl) as string | undefined;
    if (!raw) return res.status(400).json({ error: "origin or pageUrl required" });
    res.json({ binding: deps.github.getBinding(originOf(raw)) ?? null });
  });

  router.delete("/binding", (req: Request, res: Response) => {
    const raw = (req.query.origin ?? req.query.pageUrl) as string | undefined;
    if (!raw) return res.status(400).json({ error: "origin or pageUrl required" });
    res.json({ deleted: deps.github.deleteBinding(originOf(raw)) });
  });

  // --- detection ---------------------------------------------------------

  router.post("/detect", async (req: Request, res: Response) => {
    const { pageUrl, html, links, canonicalUrl } = req.body ?? {};
    if (!pageUrl) return res.status(400).json({ error: "pageUrl required" });

    const sources: string[] = [];
    if (typeof html === "string") sources.push(html);
    if (Array.isArray(links)) sources.push(...links.filter((l) => typeof l === "string"));

    const binding = deps.github.getBinding(originOf(pageUrl));
    const auth = deps.github.getAuth();
    const repoCandidates = extractRepoCandidates(sources, {
      preferOwner: deps.github.getLogin(),
      canonicalUrl: typeof canonicalUrl === "string" ? canonicalUrl : undefined,
    });

    const verify = auth
      ? (owner: string, repo: string, n: number) =>
          clientFor(auth.accessToken).prExists(owner, repo, n)
      : undefined;

    let resolved;
    try {
      resolved = await resolveSyncTarget(binding, pageUrl, verify);
    } catch (e) {
      return res.status(502).json({ error: "github request failed", detail: message(e) });
    }

    const result: DetectionResult & {
      binding: typeof binding | null;
      target: SyncTarget | null;
      prUnavailable?: boolean;
    } = {
      repoCandidates,
      detectedPr: resolved.detectedPr,
      binding: binding ?? null,
      target: resolved.target,
      ...(resolved.prUnavailable ? { prUnavailable: true } : {}),
    };
    res.json(result);
  });

  router.get("/issues", async (req: Request, res: Response) => {
    const client = authedClient(res);
    if (!client) return;
    const owner = req.query.owner as string | undefined;
    const repo = req.query.repo as string | undefined;
    const pageUrl = req.query.pageUrl as string | undefined;
    const binding = pageUrl ? deps.github.getBinding(originOf(pageUrl)) : undefined;
    const o = owner ?? binding?.owner;
    const r = repo ?? binding?.repo;
    if (!o || !r) {
      return res.status(400).json({ error: "owner and repo (or a bound pageUrl) required" });
    }
    try {
      res.json({ issues: await client.listOpenIssues(o, r) });
    } catch (e) {
      res.status(502).json({ error: "github request failed", detail: message(e) });
    }
  });

  // --- sync --------------------------------------------------------------

  router.post("/sync", async (req: Request, res: Response) => {
    const { pageUrl, target, pageTitle } = req.body ?? {};
    if (!pageUrl) return res.status(400).json({ error: "pageUrl required" });

    const client = authedClient(res);
    if (!client) return;

    const binding = deps.github.getBinding(originOf(pageUrl));
    if (!binding) {
      return res.status(409).json({
        error: "no repository connected",
        detail: "Connect a repository for this page before syncing.",
      });
    }

    let resolved: SyncTarget | null = isSyncTarget(target) ? target : null;
    if (!resolved) {
      const r = await resolveSyncTarget(binding, pageUrl, (o, rp, n) =>
        client.prExists(o, rp, n),
      );
      resolved = r.target;
    }
    if (!resolved) {
      return res.status(400).json({ error: "no sync target could be resolved" });
    }

    const comments = deps.comments.list({ status: "open", pageUrl });
    try {
      const result = await syncComments({
        comments,
        binding,
        pageUrl,
        pageTitle: typeof pageTitle === "string" ? pageTitle : undefined,
        target: resolved,
        client,
        ledger: deps.github,
      });
      res.json(result);
    } catch (e) {
      res.status(502).json({ error: "github request failed", detail: message(e) });
    }
  });

  return router;
}

function isSyncTarget(t: unknown): t is SyncTarget {
  if (!t || typeof t !== "object") return false;
  const kind = (t as { kind?: unknown }).kind;
  const number = (t as { number?: unknown }).number;
  if (kind === "pr" || kind === "issue-existing") {
    return typeof number === "number" && Number.isSafeInteger(number) && number > 0;
  }
  return kind === "issue-new";
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
