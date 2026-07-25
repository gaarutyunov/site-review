import { useCallback, useEffect, useRef, useState } from "react";
import type {
  GithubConnectionStatus,
  GithubDeviceCode,
  GithubIssue,
  GithubRepo,
  SyncResult,
  SyncTarget,
} from "@site-review/shared";
import {
  canonicalUrl,
  collectRepoLinks,
  github,
  type PageDetection,
} from "../lib/github";
import { COLORS } from "./types";

interface Props {
  pageUrl: string;
  pageTitle: string;
  /** Rendered inside the curtain; only loads while the curtain is open. */
  active: boolean;
  /** Open comments on this page — nothing to sync when zero. */
  openCount: number;
}

type IssueChoice = { kind: "new" } | { kind: "existing"; number: number };

/**
 * The curtain's GitHub section: connect the account, connect a repository for
 * this page, see the resolved target (detected PR, or an issue to append to /
 * create), and push the page's open comments to it.
 */
export function GithubPanel({ pageUrl, pageTitle, active, openCount }: Props) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<GithubConnectionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [device, setDevice] = useState<GithubDeviceCode | null>(null);
  const [detection, setDetection] = useState<PageDetection | null>(null);
  const [repos, setRepos] = useState<GithubRepo[] | null>(null);
  const [issues, setIssues] = useState<GithubIssue[] | null>(null);
  const [issueChoice, setIssueChoice] = useState<IssueChoice>({ kind: "new" });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, []);

  const refreshDetection = useCallback(async () => {
    const d = await run(() =>
      github.detect(pageUrl, collectRepoLinks(), canonicalUrl()),
    );
    if (d) setDetection(d);
  }, [pageUrl, run]);

  // --- load status + detection while the panel is visible ---------------
  useEffect(() => {
    if (!active || !open) return;
    void run(() => github.status()).then((s) => {
      if (s) setStatus(s);
    });
    void refreshDetection();
  }, [active, open, run, refreshDetection]);

  // --- poll while a device authorization is outstanding ------------------
  useEffect(() => {
    if (!device) return;
    const every = Math.max(device.interval, 2) * 1000;
    pollRef.current = setInterval(() => {
      void github
        .status()
        .then((s) => {
          setStatus(s);
          if (s.authenticated || (!s.pending && s.reason)) {
            setDevice(null);
            if (s.authenticated) void refreshDetection();
          }
        })
        .catch(() => {});
    }, every);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [device, refreshDetection]);

  const connect = async () => {
    setBusy(true);
    const code = await run(() => github.connect());
    setBusy(false);
    if (code) setDevice(code);
  };

  const disconnect = async () => {
    await run(() => github.disconnect());
    setDevice(null);
    setRepos(null);
    setIssues(null);
    setResult(null);
    const s = await run(() => github.status());
    if (s) setStatus(s);
  };

  const loadRepos = async () => {
    setBusy(true);
    const r = await run(() => github.repos());
    setBusy(false);
    if (r) setRepos(r.repos);
  };

  const bind = async (owner: string, repo: string) => {
    setBusy(true);
    await run(() => github.bind(pageUrl, owner, repo));
    setRepos(null);
    setIssues(null);
    setResult(null);
    await refreshDetection();
    setBusy(false);
  };

  const unbind = async () => {
    setBusy(true);
    await run(() => github.unbind(pageUrl));
    setIssues(null);
    setResult(null);
    await refreshDetection();
    setBusy(false);
  };

  const loadIssues = async () => {
    setBusy(true);
    const r = await run(() => github.issues(pageUrl));
    setBusy(false);
    if (r) setIssues(r.issues);
  };

  const target: SyncTarget | null = detection?.detectedPr && !detection.prUnavailable
    ? { kind: "pr", number: detection.detectedPr.number }
    : issueChoice.kind === "existing"
      ? { kind: "issue-existing", number: issueChoice.number }
      : { kind: "issue-new" };

  const sync = async () => {
    if (!target) return;
    setBusy(true);
    setResult(null);
    const r = await run(() => github.sync(pageUrl, pageTitle, target));
    setBusy(false);
    if (r) setResult(r);
  };

  const connected = detection?.binding;
  const authenticated = status?.authenticated;

  return (
    <div style={{ borderTop: "1px solid #3b3b52", padding: "10px 14px" }}>
      <button onClick={() => setOpen((o) => !o)} style={headerBtn}>
        <span>
          {"▸"} GitHub
          {connected ? ` · ${connected.owner}/${connected.repo}` : ""}
        </span>
        <span style={{ color: "#9ca3af", fontWeight: 500 }}>
          {authenticated ? (status?.login ?? "connected") : "not connected"}
        </span>
      </button>

      {open && (
        <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
          {error && <div style={errorBox}>{error}</div>}

          {status && !status.configured && (
            <div style={hint}>
              The server has no GitHub App configured. Set{" "}
              <code>GITHUB_APP_CLIENT_ID</code> and restart it — see the README.
            </div>
          )}

          {/* --- account ------------------------------------------------ */}
          {status?.configured && !authenticated && !device && (
            <button onClick={connect} disabled={busy} style={primaryBtn}>
              Connect GitHub
            </button>
          )}

          {device && (
            <div style={hint}>
              Enter code <strong style={{ fontFamily: "ui-monospace, monospace" }}>
                {device.userCode}
              </strong>{" "}
              at{" "}
              <a href={device.verificationUri} target="_blank" rel="noreferrer" style={link}>
                {device.verificationUri.replace(/^https?:\/\//, "")}
              </a>
              . Waiting for authorization…
            </div>
          )}

          {!authenticated && status?.reason && (
            <div style={hint}>Last attempt: {status.reason}</div>
          )}

          {/* --- repository --------------------------------------------- */}
          {authenticated && !connected && (
            <div style={{ display: "grid", gap: 6 }}>
              <div style={label}>Connect a repository for this site</div>
              {detection?.repoCandidates.length ? (
                detection.repoCandidates.slice(0, 5).map((c, i) => (
                  <button
                    key={`${c.owner}/${c.repo}`}
                    onClick={() => bind(c.owner, c.repo)}
                    disabled={busy}
                    style={i === 0 ? primaryBtn : secondaryBtn}
                  >
                    {c.owner}/{c.repo}
                    {i === 0 ? " (detected)" : ""}
                  </button>
                ))
              ) : (
                <div style={hint}>No GitHub repository link found on this page.</div>
              )}
              {repos ? (
                <select
                  onChange={(e) => {
                    const [owner, repo] = e.target.value.split("/");
                    if (owner && repo) void bind(owner, repo);
                  }}
                  defaultValue=""
                  style={select}
                >
                  <option value="" disabled>
                    Pick from your repositories…
                  </option>
                  {repos.map((r) => (
                    <option key={`${r.owner}/${r.repo}`} value={`${r.owner}/${r.repo}`}>
                      {r.owner}/{r.repo}
                    </option>
                  ))}
                </select>
              ) : (
                <button onClick={loadRepos} disabled={busy} style={secondaryBtn}>
                  Choose another repository…
                </button>
              )}
            </div>
          )}

          {/* --- target + sync ------------------------------------------ */}
          {authenticated && connected && (
            <div style={{ display: "grid", gap: 8 }}>
              <div style={label}>
                Target
                <button onClick={unbind} disabled={busy} style={linkBtn}>
                  change repo
                </button>
              </div>

              {detection?.detectedPr && !detection.prUnavailable ? (
                <div style={hint}>
                  Pull request <strong>#{detection.detectedPr.number}</strong> — detected
                  from the preview URL.
                </div>
              ) : (
                <div style={{ display: "grid", gap: 6 }}>
                  {detection?.prUnavailable && (
                    <div style={hint}>
                      PR #{detection.detectedPr?.number} is not available in{" "}
                      {connected.owner}/{connected.repo} — syncing to an issue instead.
                    </div>
                  )}
                  {issues ? (
                    <select
                      value={issueChoice.kind === "existing" ? String(issueChoice.number) : "new"}
                      onChange={(e) =>
                        setIssueChoice(
                          e.target.value === "new"
                            ? { kind: "new" }
                            : { kind: "existing", number: Number(e.target.value) },
                        )
                      }
                      style={select}
                    >
                      <option value="new">Create a new issue</option>
                      {issues.map((i) => (
                        <option key={i.number} value={String(i.number)}>
                          #{i.number} {i.title}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <button onClick={loadIssues} disabled={busy} style={secondaryBtn}>
                      Append to an existing issue…
                    </button>
                  )}
                </div>
              )}

              <button onClick={sync} disabled={busy || openCount === 0} style={primaryBtn}>
                {busy ? "Syncing…" : `Sync ${openCount} open comment${openCount === 1 ? "" : "s"}`}
              </button>

              {result && (
                <div style={hint}>
                  {result.synced === 0 && result.skipped === 0
                    ? "Nothing to sync."
                    : `Synced ${result.synced}${result.skipped ? ` · ${result.skipped} already on GitHub` : ""}.`}
                  {result.links.map((l) => (
                    <span key={l.url}>
                      {" "}
                      <a href={l.url} target="_blank" rel="noreferrer" style={link}>
                        view on GitHub
                      </a>
                    </span>
                  ))}
                </div>
              )}

              <button onClick={disconnect} disabled={busy} style={linkBtn}>
                Disconnect GitHub
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const headerBtn: React.CSSProperties = {
  width: "100%",
  display: "flex",
  justifyContent: "space-between",
  gap: 8,
  background: "none",
  border: "none",
  color: "#e5e7eb",
  cursor: "pointer",
  font: "inherit",
  fontWeight: 700,
  padding: 0,
  textAlign: "left",
};

const primaryBtn: React.CSSProperties = {
  background: COLORS.select,
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "8px 12px",
  fontWeight: 700,
  fontSize: 12,
  cursor: "pointer",
};

const secondaryBtn: React.CSSProperties = {
  ...primaryBtn,
  background: "#3b3b52",
  fontWeight: 600,
};

const linkBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#9ca3af",
  cursor: "pointer",
  fontSize: 11,
  fontWeight: 600,
  padding: 0,
  justifySelf: "start",
};

const select: React.CSSProperties = {
  background: "#2a2a3c",
  color: "#e5e7eb",
  border: "1px solid #3b3b52",
  borderRadius: 8,
  padding: "6px 8px",
  fontSize: 12,
  maxWidth: "100%",
};

const label: React.CSSProperties = {
  color: "#9ca3af",
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 0.4,
  display: "flex",
  justifyContent: "space-between",
  gap: 8,
};

const hint: React.CSSProperties = { color: "#9ca3af", fontSize: 12, lineHeight: 1.5 };

const errorBox: React.CSSProperties = {
  ...hint,
  color: "#fca5a5",
  background: "#2a1f2a",
  borderRadius: 8,
  padding: "6px 8px",
};

const link: React.CSSProperties = { color: COLORS.select };
