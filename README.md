# MCP OAuth — Supabase

<p>
  <a href="https://github.com/mcp-use/mcp-use">Built with <b>mcp-use</b></a>
  &nbsp;
  <a href="https://github.com/mcp-use/mcp-use">
    <img src="https://img.shields.io/github/stars/mcp-use/mcp-use?style=social" alt="mcp-use stars">
  </a>
</p>

An MCP server template that uses **Supabase's OAuth 2.1 server** for authentication. Supabase hosts `/authorize`, `/token`, `/register`, and `.well-known` discovery on its own infrastructure — this template only hosts the consent screen (which also handles sign-in for unauthenticated users) and verifies the resulting JWTs.

## Features

- **Supabase-hosted OAuth 2.1 server** — Supabase handles registration, authorization, token issuance, and discovery
- **Custom consent UI** — `src/auth-routes.ts` renders the sign-in + consent pages on your domain
- **Anonymous sign-in** — zero-setup demo auth (swap for email/password, magic links, or social providers in production)
- **Automatic JWT verification** — new Supabase projects sign with ES256 and publish JWKS; the provider fetches and caches it
- **Authenticated Supabase queries** — example `list-notes` tool calls Supabase with the user's token, so RLS policies apply

## Prerequisites

- **Node.js 20+** (22 recommended)
- **pnpm 10+**
- A **Supabase project** (free tier works) — create one at <https://supabase.com>

## Setup

### 1. Create a Supabase project

In the Supabase Dashboard:

1. Note your **Project ID** from **Project Settings** → **General**.
2. Copy your **Publishable key** (`sb_publishable_...`) from **Project Settings** → **API Keys**.
   This is the modern replacement for the legacy anon JWT key.

### 2. Configure the OAuth server

In the Supabase Dashboard, under **Authentication** → **OAuth Server**:

1. Enable the OAuth Server.
2. Set the **consent screen URL** to:
   ```
   http://localhost:3000/auth/consent
   ```
   (For production, change this to your deployed URL.)

### 3. Enable anonymous sign-ins

Under **Authentication** → **Providers** → **Anonymous**, toggle anonymous sign-ins on.
This template uses anonymous sign-in for the demo flow — swap it for a real provider before going to production.

### 4. (Optional) Create the `notes` table

The `list-notes` tool queries a `notes` table. To exercise it, create one:

```sql
create table notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null default auth.uid(),
  body text not null,
  created_at timestamptz not null default now()
);

alter table notes enable row level security;

create policy "Users can read their own notes"
  on notes for select
  using (auth.uid() = user_id);
```

### 5. Configure environment variables

```bash
cp .env.example .env
```

```bash
MCP_USE_OAUTH_SUPABASE_PROJECT_ID=your-project-id
MCP_USE_OAUTH_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

### 6. Install and run

```bash
pnpm install
pnpm dev
```

The server starts on port **3000** with the inspector at <http://localhost:3000/inspector>.

## Try it out

1. Open <http://localhost:3000/inspector>
2. Connect to `http://localhost:3000/mcp`
3. Inspector triggers the OAuth flow — Supabase redirects you to `/auth/consent` here
4. Click **Continue as guest** (anonymous sign-in), then **Allow** on the consent page
5. Back in the inspector, call:
   - `get-user-info` — returns your user id and email (empty for anonymous users)
   - `list-notes` — returns your notes (requires the table from step 4 + a row with `user_id = auth.uid()`)

## Available tools

| Tool            | Description                                                              |
| --------------- | ------------------------------------------------------------------------ |
| `get-user-info` | Returns the authenticated user's id and email                            |
| `list-notes`    | Reads the user's `notes` rows via Supabase (RLS-protected)               |

## How the OAuth flow works

```
MCP Client ──(1) MCP request without token ─▶ MCP Server ──▶ 401 + WWW-Authenticate
MCP Client ──(2) GET /.well-known/oauth-protected-resource ─▶ MCP Server
MCP Client ──(3) GET /.well-known/oauth-authorization-server ─▶ Supabase
MCP Client ──(4) Dynamic Client Registration ─▶ Supabase
MCP Client ──(5) GET /authorize ─▶ Supabase ──▶ redirect to /auth/consent (this server)
              ──▶ user signs in + approves scopes
              ──▶ /auth/consent posts back to Supabase ──▶ redirect to MCP client with code
MCP Client ──(6) Token exchange ─▶ Supabase
MCP Client ──(7) MCP request + Bearer <jwt> ─▶ MCP Server (verifies via Supabase JWKS)
```

## Deploy

```bash
npx mcp-use deploy
```

Before deploying:

1. Update the consent screen URL in the Supabase Dashboard to your deployed URL (e.g. `https://your-app.run.mcp-use.com/auth/consent`).
2. Replace anonymous sign-in with a real provider in `src/auth-routes.ts`.
3. For the `list-notes` example, ensure your RLS policies are correct for your data model.

## Customizing

### Swap anonymous sign-in for a real provider

Edit `src/auth-routes.ts` — replace the `signInAnonymously()` call in the `/auth/signin` handler with `signInWithPassword`, `signInWithOAuth`, or `signInWithOtp`. See the [Supabase Auth docs](https://supabase.com/docs/guides/auth).

### Production session storage

The demo stores the Supabase session in a short-lived HttpOnly cookie. For production, prefer signed/encrypted session storage.

## Learn more

- [Supabase MCP Authentication guide](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication)
- [Supabase Auth docs](https://supabase.com/docs/guides/auth)
- [mcp-use docs](https://mcp-use.com/docs)
- [MCP Authorization spec](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)

## License

MIT
