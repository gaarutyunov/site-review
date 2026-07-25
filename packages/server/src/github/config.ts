/**
 * GitHub App configuration, read from the environment (design D7). Nothing is
 * committed; when the client id is absent the whole `/github/*` surface reports
 * "not configured" instead of failing at call time.
 */
export interface GithubConfig {
  clientId: string;
  /** Optional — only needed if a future flow signs App JWTs. */
  appId?: string;
  privateKey?: string;
}

export function githubConfig(env: NodeJS.ProcessEnv = process.env): GithubConfig | null {
  const clientId = env.GITHUB_APP_CLIENT_ID?.trim();
  if (!clientId) return null;
  return {
    clientId,
    appId: env.GITHUB_APP_ID?.trim() || undefined,
    privateKey: env.GITHUB_APP_PRIVATE_KEY?.trim() || undefined,
  };
}
