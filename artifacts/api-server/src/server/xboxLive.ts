/**
 * Xbox Live identity verification.
 *
 * Flow: Microsoft consumer OAuth (login.microsoftonline.com/consumers) ->
 * Xbox Live "user" token (XASU) -> Xbox Live "XSTS" token, whose claims carry
 * the caller's real gamertag (gtg) and XUID (xid) directly from Microsoft —
 * never something the user typed in. See docs referenced in the Profile UI
 * copy for why this is Xbox-only: Sony has no equivalent third-party API.
 */

const MSA_AUTHORIZE_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize";
const MSA_TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const XBL_USER_AUTH_URL = "https://user.auth.xboxlive.com/user/authenticate";
const XBL_XSTS_URL = "https://xsts.auth.xboxlive.com/xsts/authorize";
const SCOPE = "XboxLive.signin XboxLive.offline_access";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} environment variable is required but was not provided.`);
  return value;
}

export function xboxRedirectUri(): string {
  return `${requireEnv("CALLBACK_BASE_URL").replace(/\/$/, "")}/api/xbox/link/callback`;
}

export function buildAuthorizeUrl(state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    client_id: requireEnv("XBOX_CLIENT_ID"),
    response_type: "code",
    redirect_uri: xboxRedirectUri(),
    scope: SCOPE,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `${MSA_AUTHORIZE_URL}?${params.toString()}`;
}

type MsaTokens = { access_token: string; refresh_token?: string; expires_in: number };

export class XboxVerificationError extends Error {
  constructor(
    message: string,
    public readonly reason: string,
  ) {
    super(message);
    this.name = "XboxVerificationError";
  }
}

async function postForm<T>(url: string, body: URLSearchParams): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new XboxVerificationError(`Microsoft token exchange failed (${res.status})`, "token_exchange_failed");
  }
  return res.json() as Promise<T>;
}

export async function exchangeCodeForMsaTokens(code: string, codeVerifier: string): Promise<MsaTokens> {
  return postForm<MsaTokens>(
    MSA_TOKEN_URL,
    new URLSearchParams({
      client_id: requireEnv("XBOX_CLIENT_ID"),
      client_secret: requireEnv("XBOX_CLIENT_SECRET"),
      grant_type: "authorization_code",
      code,
      redirect_uri: xboxRedirectUri(),
      code_verifier: codeVerifier,
      scope: SCOPE,
    }),
  );
}

export async function refreshMsaTokens(refreshToken: string): Promise<MsaTokens> {
  return postForm<MsaTokens>(
    MSA_TOKEN_URL,
    new URLSearchParams({
      client_id: requireEnv("XBOX_CLIENT_ID"),
      client_secret: requireEnv("XBOX_CLIENT_SECRET"),
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: SCOPE,
    }),
  );
}

type XblAuthResponse = {
  Token: string;
  DisplayClaims: { xui: Array<{ uhs: string; gtg?: string; xid?: string }> };
};

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as (T & { XErr?: number }) | null;
  if (!res.ok || !data) {
    throw new XboxVerificationError(`Xbox Live request failed (${res.status})`, "xbox_live_failed");
  }
  return data as T;
}

/** XSTS error codes Microsoft documents as user-facing, not transient failures. */
function friendlyXstsReason(xErr: number | undefined): string {
  switch (xErr) {
    case 2148916233:
      return "no_xbox_account";
    case 2148916235:
      return "region_unavailable";
    case 2148916236:
    case 2148916237:
      return "adult_verification_required";
    case 2148916238:
      return "child_account";
    default:
      return "xbox_live_failed";
  }
}

export type VerifiedXboxIdentity = { gamertag: string; xuid: string };

/**
 * Exchanges a Microsoft access token for the caller's verified Xbox Live
 * gamertag and XUID. Throws XboxVerificationError with a `reason` safe to
 * show the user (never the raw upstream error body).
 */
export async function verifyXboxIdentity(msaAccessToken: string): Promise<VerifiedXboxIdentity> {
  const userAuth = await postJson<XblAuthResponse>(XBL_USER_AUTH_URL, {
    RelyingParty: "http://auth.xboxlive.com",
    TokenType: "JWT",
    Properties: {
      AuthMethod: "RPS",
      SiteName: "user.auth.xboxlive.com",
      RpsTicket: `d=${msaAccessToken}`,
    },
  });

  let xsts: XblAuthResponse;
  try {
    xsts = await postJson<XblAuthResponse & { XErr?: number }>(XBL_XSTS_URL, {
      RelyingParty: "http://xboxlive.com",
      TokenType: "JWT",
      Properties: {
        SandboxId: "RETAIL",
        UserTokens: [userAuth.Token],
      },
    });
  } catch {
    // The XSTS endpoint returns 401 with an XErr code in the body for the
    // known "no Xbox account" / age-gate cases — re-fetch to read XErr since
    // postJson already consumed the error path above.
    const res = await fetch(XBL_XSTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        RelyingParty: "http://xboxlive.com",
        TokenType: "JWT",
        Properties: { SandboxId: "RETAIL", UserTokens: [userAuth.Token] },
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { XErr?: number };
    const reason = friendlyXstsReason(body.XErr);
    throw new XboxVerificationError("Xbox Live could not verify this account", reason);
  }

  const claim = xsts.DisplayClaims.xui[0];
  if (!claim?.gtg || !claim?.xid) {
    throw new XboxVerificationError("Xbox Live did not return a gamertag", "no_gamertag");
  }
  return { gamertag: claim.gtg, xuid: claim.xid };
}
