/**
 * Custom authorization UI for Supabase's OAuth 2.1 server.
 *
 * Supabase hosts /authorize, /token, /register, and .well-known discovery on
 * its own infrastructure. You configure a consent-screen URL in the dashboard
 * (Authentication → OAuth Server) — when a user needs to approve an OAuth
 * client, Supabase redirects their browser here with `?authorization_id=<uuid>`.
 *
 * Routes:
 *   GET  /oauth/consent?authorization_id=<id>
 *        Renders the sign-in page if the visitor has no session, otherwise
 *        fetches the authorization details from Supabase and renders consent.
 *   GET  /oauth/signin/:provider?authorization_id=<id>
 *        Kicks off a Supabase social sign-in (Google or GitHub). Supabase
 *        issues the authorize URL and we 302 to it; PKCE state is stored
 *        in cookies by @supabase/ssr.
 *   GET  /oauth/callback?code=<code>&authorization_id=<id>
 *        Exchange point after the user returns from Google/GitHub. The
 *        code is swapped for a session, the session is written to cookies,
 *        and we redirect back to /oauth/consent.
 *   POST /oauth/consent?authorization_id=<id>
 *        Body: { approve: boolean }
 *        Forwards the decision to Supabase, which responds with a redirect_url
 *        pointing back to the MCP client.
 *
 * Enable the Google and GitHub providers in the Supabase Dashboard
 * (Authentication → Providers) and add `<SITE_URL>/oauth/callback` to the
 * allowed redirect URLs.
 *
 * Docs: https://supabase.com/docs/guides/auth/oauth-server
 */

import type { MCPServer } from "mcp-use/server";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";

import { renderConsentPage, renderSignInPage } from "./views/index.js";
import { safeJson } from "./render.js";

export interface MountAuthRoutesOptions {
  projectId: string;
  publishableKey: string;
  /**
   * Absolute URL the browser uses to reach this server (no trailing slash).
   * Used to build the OAuth callback URL. Defaults to the request origin,
   * which is fine for local dev but may be wrong behind proxies — set
   * MCP_USE_OAUTH_SUPABASE_SITE_URL in production.
   */
  siteUrl?: string;
}

type Provider = "google" | "github";
const PROVIDERS: Provider[] = ["google", "github"];

function supabaseProjectUrl(projectId: string): string {
  return `https://${projectId}.supabase.co`;
}

function getSupabaseClient(
  c: Context,
  url: string,
  key: string,
): SupabaseClient {
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        const all = getCookie(c);
        return Object.entries(all).map(([name, value]) => ({ name, value }));
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          setCookie(c, name, value, options as Parameters<typeof setCookie>[3]);
        }
      },
    },
  });
}

function originFromRequest(c: Context, override: string | undefined): string {
  if (override) return override.replace(/\/$/, "");
  return new URL(c.req.url).origin;
}

export function mountAuthRoutes(
  server: MCPServer,
  { projectId, publishableKey, siteUrl }: MountAuthRoutesOptions,
): void {
  const supabaseUrl = supabaseProjectUrl(projectId);

  // -------------------------------------------------------------------------
  // GET /oauth/consent?authorization_id=<id>
  //
  // This is the URL to configure as the consent screen in the Supabase
  // dashboard. Supabase redirects the browser here with only
  // `authorization_id`. If the user has no session we render sign-in;
  // otherwise we fetch the authorization details and render consent.
  // -------------------------------------------------------------------------
  server.app.get("/oauth/consent", async (c) => {
    console.log("[auth-routes] GET /oauth/consent hit:", new URL(c.req.url).search);
    const authorizationId = new URL(c.req.url).searchParams.get(
      "authorization_id",
    );
    if (!authorizationId) {
      return c.text("Missing authorization_id", 400);
    }

    const supabase = getSupabaseClient(c, supabaseUrl, publishableKey);
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      const providerHrefs = {
        google: `/oauth/signin/google?authorization_id=${encodeURIComponent(authorizationId)}`,
        github: `/oauth/signin/github?authorization_id=${encodeURIComponent(authorizationId)}`,
      };
      return c.html(renderSignInPage({ providerHrefs }));
    }

    const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(
      authorizationId,
    );

    if (error || !data) {
      return c.text(
        `Failed to fetch authorization details: ${error?.message ?? "unknown error"}`,
        500,
      );
    }

    // If the user has already consented to these scopes, Supabase short-
    // circuits and returns a redirect URL — honor it immediately.
    if ("redirect_url" in data) {
      return c.redirect(data.redirect_url as string, 302);
    }

    const clientName =
      (data as { client?: { name?: string } }).client?.name || "the application";
    const clientUri =
      (data as { client?: { uri?: string | null } }).client?.uri ?? null;
    const rawScope = (data as { scope?: string }).scope || "";
    const scopes = rawScope ? rawScope.split(" ").filter(Boolean) : [];

    const consentScript = `
(function () {
  const AUTH_ID = ${safeJson(authorizationId)};
  const buttons = document.querySelectorAll('[data-consent]');
  buttons.forEach(function (btn) {
    btn.addEventListener('click', async function () {
      buttons.forEach(function (b) { b.disabled = true; });
      try {
        const res = await fetch('/oauth/consent?authorization_id=' + encodeURIComponent(AUTH_ID), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ approve: btn.dataset.consent === 'approve' }),
        });
        const data = await res.json();
        if (data && data.redirect_url) { window.location.href = data.redirect_url; return; }
        throw new Error((data && data.error) || 'Consent failed');
      } catch (err) {
        buttons.forEach(function (b) { b.disabled = false; });
        const msg = document.getElementById('consent-error');
        if (msg) msg.textContent = String((err && err.message) || err);
      }
    });
  });
})();
`;

    return c.html(
      renderConsentPage({ clientName, clientUri, scopes, consentScript }),
    );
  });

  // -------------------------------------------------------------------------
  // GET /oauth/signin/:provider?authorization_id=<id>
  // Starts a Supabase social OAuth flow. The returned URL redirects the
  // browser to the provider (Google/GitHub); PKCE state is set by
  // @supabase/ssr via cookies on this response.
  // -------------------------------------------------------------------------
  server.app.get("/oauth/signin/:provider", async (c) => {
    console.log("[auth-routes] /oauth/signin hit:", c.req.param("provider"));
    const provider = c.req.param("provider") as Provider;
    if (!PROVIDERS.includes(provider)) {
      return c.text(`Unsupported provider: ${provider}`, 400);
    }

    const authorizationId = new URL(c.req.url).searchParams.get(
      "authorization_id",
    );
    if (!authorizationId) {
      return c.text("Missing authorization_id", 400);
    }

    const origin = originFromRequest(c, siteUrl);
    const callbackUrl = `${origin}/oauth/callback?authorization_id=${encodeURIComponent(authorizationId)}`;

    const supabase = getSupabaseClient(c, supabaseUrl, publishableKey);
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: callbackUrl,
        skipBrowserRedirect: true,
      },
    });

    if (error || !data?.url) {
      return c.text(
        `Failed to start ${provider} sign-in: ${error?.message ?? "no URL returned"}. ` +
          `Make sure the ${provider} provider is enabled in the Supabase dashboard.`,
        500,
      );
    }

    return c.redirect(data.url, 302);
  });

  // -------------------------------------------------------------------------
  // GET /oauth/callback?code=<code>&authorization_id=<id>
  // Exchange the code for a session. @supabase/ssr writes the session
  // cookies automatically through our cookie adapter.
  // -------------------------------------------------------------------------
  server.app.get("/oauth/callback", async (c) => {
    const url = new URL(c.req.url);
    console.log("[auth-routes] /oauth/callback hit:", url.search);
    const code = url.searchParams.get("code");
    const authorizationId = url.searchParams.get("authorization_id");
    const providerError = url.searchParams.get("error_description");

    if (providerError) {
      return c.text(`Provider error: ${providerError}`, 400);
    }
    if (!code || !authorizationId) {
      return c.text("Missing code or authorization_id", 400);
    }

    const supabase = getSupabaseClient(c, supabaseUrl, publishableKey);
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      return c.text(`Sign-in failed: ${error.message}`, 500);
    }

    return c.redirect(
      `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`,
      302,
    );
  });

  // -------------------------------------------------------------------------
  // POST /oauth/consent?authorization_id=<id>
  //   body: { approve: boolean }
  // Forwards the decision to Supabase, which responds with a redirect_url
  // pointing back to the MCP client (with `code` & `state`, or an error).
  // -------------------------------------------------------------------------
  server.app.post("/oauth/consent", async (c) => {
    const authorizationId = new URL(c.req.url).searchParams.get(
      "authorization_id",
    );
    if (!authorizationId) {
      return c.json({ error: "Missing authorization_id" }, 400);
    }

    const { approve } = await c.req.json<{ approve: boolean }>();
    const supabase = getSupabaseClient(c, supabaseUrl, publishableKey);
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      return c.json({ error: "not_authenticated" }, 401);
    }

    // `skipBrowserRedirect: true` keeps the SDK from trying to redirect the
    // (nonexistent) browser window on the server — we hand the URL back to
    // the client-side consent page, which performs the navigation.
    const { data, error } = approve
      ? await supabase.auth.oauth.approveAuthorization(authorizationId, {
          skipBrowserRedirect: true,
        })
      : await supabase.auth.oauth.denyAuthorization(authorizationId, {
          skipBrowserRedirect: true,
        });

    if (error || !data) {
      return c.json({ error: error?.message ?? "Consent failed" }, 500);
    }

    return c.json({ redirect_url: (data as { redirect_url: string }).redirect_url });
  });
}
