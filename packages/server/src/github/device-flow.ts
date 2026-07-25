import { createOAuthDeviceAuth } from "@octokit/auth-oauth-device";
import type { GithubDeviceCode } from "@site-review/shared";
import { OctokitGithubClient, type GithubClient } from "./client.js";
import type { GithubStore } from "./store.js";

/** What GitHub hands back when the device code is issued. */
interface Verification {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

/**
 * Runs one OAuth **device** authorization at a time (design D1): the server
 * requests a device code, the extension shows the user code, and the strategy
 * polls GitHub in the background until the user authorizes, denies, or the code
 * expires. Only on success is a token written to the store.
 *
 * `authorize` and `clientFor` are injectable so tests can drive the flow
 * without touching the network.
 */
export class DeviceFlow {
  private pending: GithubDeviceCode | null = null;
  private lastError: string | null = null;

  constructor(
    private clientId: string,
    private store: GithubStore,
    private deps: {
      /** Start a device authorization; resolves with the user access token. */
      authorize?: (
        clientId: string,
        onVerification: (v: Verification) => void,
      ) => Promise<string>;
      clientFor?: (token: string) => GithubClient;
    } = {},
  ) {}

  /** True while GitHub is being polled for this device code. */
  isPending(): boolean {
    return this.pending !== null;
  }

  pendingCode(): GithubDeviceCode | null {
    return this.pending;
  }

  /** Reason the last flow ended without a token (denied, expired, …). */
  error(): string | null {
    return this.lastError;
  }

  clearError(): void {
    this.lastError = null;
  }

  /**
   * Begin (or re-expose) a device authorization. A flow already in progress is
   * returned as-is so a double click doesn't invalidate the code on screen.
   */
  async start(): Promise<GithubDeviceCode> {
    if (this.pending) return this.pending;
    this.lastError = null;

    let resolveCode: (c: GithubDeviceCode) => void;
    let rejectCode: (e: unknown) => void;
    const code = new Promise<GithubDeviceCode>((resolve, reject) => {
      resolveCode = resolve;
      rejectCode = reject;
    });

    const authorize = this.deps.authorize ?? defaultAuthorize;
    const onVerification = (v: Verification) => {
      this.pending = {
        userCode: v.user_code,
        verificationUri: v.verification_uri,
        expiresIn: v.expires_in,
        interval: v.interval,
      };
      resolveCode(this.pending);
    };

    authorize(this.clientId, onVerification)
      .then(async (token) => {
        const client = (this.deps.clientFor ?? ((t: string) => new OctokitGithubClient(t)))(token);
        const login = await client.whoami();
        this.store.setAuth({ login, accessToken: token });
        this.pending = null;
      })
      .catch((e: unknown) => {
        this.lastError = describeError(e);
        this.pending = null;
        rejectCode(e);
      });

    return code;
  }
}

/** The real device flow: `@octokit/auth-oauth-device` against a GitHub App. */
async function defaultAuthorize(
  clientId: string,
  onVerification: (v: Verification) => void,
): Promise<string> {
  const auth = createOAuthDeviceAuth({
    clientType: "github-app",
    clientId,
    onVerification: (v) => onVerification(v as unknown as Verification),
  });
  const result = (await auth({ type: "oauth" })) as { token: string };
  return result.token;
}

function describeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/access_denied/i.test(msg)) return "authorization denied";
  if (/expired_token|expired/i.test(msg)) return "device code expired";
  return msg;
}
