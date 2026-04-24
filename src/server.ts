/**
 * Supabase OAuth MCP Server
 *
 * Uses Supabase's OAuth 2.1 server — Supabase hosts /authorize, /token,
 * /register and .well-known discovery, while this example hosts the consent
 * screen (which also triggers sign-in for unauthenticated users). Configure
 * the consent URL in the Supabase Dashboard (Authentication → OAuth Server)
 * to point at /auth/consent here.
 *
 * Google and GitHub social login are wired up by default. Enable either
 * provider in the Supabase Dashboard under Auth → Providers and add the
 * OAuth callback URL `<SITE_URL>/auth/callback` to the allowed redirects.
 *
 * Token verification is automatic: new Supabase projects sign tokens with
 * ES256 and publish a JWKS endpoint, which the provider fetches and caches.
 * No JWT secret configuration is required.
 *
 * Docs: https://supabase.com/docs/guides/auth/oauth-server
 *
 * Environment variables:
 * - MCP_USE_OAUTH_SUPABASE_PROJECT_ID       (required)
 * - MCP_USE_OAUTH_SUPABASE_PUBLISHABLE_KEY  (required — used by the consent UI
 *                                            and by tools calling Supabase)
 * - MCP_USE_OAUTH_SUPABASE_SITE_URL         (optional; defaults to the request
 *                                            origin — set for production/proxies)
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MCPServer,
  oauthSupabaseProvider,
  error,
  object,
} from "mcp-use/server";
import { createClient } from "@supabase/supabase-js";

import { mountAuthRoutes } from "./auth-routes.js";

declare const process: { env: Record<string, string | undefined> };

const SUPABASE_PROJECT_ID =
  process.env.MCP_USE_OAUTH_SUPABASE_PROJECT_ID ?? "";
const SUPABASE_PUBLISHABLE_KEY =
  process.env.MCP_USE_OAUTH_SUPABASE_PUBLISHABLE_KEY ?? "";
const SITE_URL = process.env.MCP_USE_OAUTH_SUPABASE_SITE_URL;

if (!SUPABASE_PROJECT_ID) {
  console.warn(
    "Warning: MCP_USE_OAUTH_SUPABASE_PROJECT_ID is not set — set it before using the server.",
  );
}
if (!SUPABASE_PUBLISHABLE_KEY) {
  console.warn(
    "Warning: MCP_USE_OAUTH_SUPABASE_PUBLISHABLE_KEY is not set — set it before using the server.",
  );
}

const supabaseUrl = `https://${SUPABASE_PROJECT_ID}.supabase.co`;

const server = new MCPServer({
  name: "mcp-oauth-supabase",
  version: "1.0.0",
  description: "MCP server with Supabase OAuth authentication",
  oauth: oauthSupabaseProvider(),
});

// ---------------------------------------------------------------------------
// Serve the compiled Tailwind stylesheet
// ---------------------------------------------------------------------------

const stylesCss = readFileSync(
  join(process.cwd(), "public", "styles.css"),
  "utf-8",
);

server.app.get("/styles.css", () => {
  return new Response(stylesCss, {
    status: 200,
    headers: {
      "Content-Type": "text/css; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
});

// Mount the consent + sign-in pages that Supabase redirects to after /authorize.
mountAuthRoutes(server, {
  projectId: SUPABASE_PROJECT_ID,
  publishableKey: SUPABASE_PUBLISHABLE_KEY,
  siteUrl: SITE_URL,
});

server.tool(
  {
    name: "get-user-info",
    description: "Get information about the authenticated user",
  },
  async (_args, ctx) =>
    object({
      userId: ctx.auth.user.userId,
      email: ctx.auth.user.email,
    }),
);

server.tool(
  {
    name: "list-notes",
    description:
      "Fetch the user's notes from Supabase using their access token",
  },
  async (_args, ctx) => {
    const supabase = createClient(supabaseUrl, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        headers: { Authorization: `Bearer ${ctx.auth.accessToken}` },
      },
    });

    const { data, error: queryError } = await supabase.from("notes").select();

    if (queryError) {
      return error(`Failed to fetch notes: ${queryError.message}`);
    }

    return object({ notes: data ?? [] });
  },
);

server.listen().then(() => {
  console.log("Supabase OAuth MCP Server Running");
});
