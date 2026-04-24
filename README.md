# MCP OAuth — Supabase

<p>
  <a href="https://github.com/mcp-use/mcp-use">Built with <b>mcp-use</b></a>
  &nbsp;
  <a href="https://github.com/mcp-use/mcp-use">
    <img src="https://img.shields.io/github/stars/mcp-use/mcp-use?style=social" alt="mcp-use stars">
  </a>
</p>

An MCP server template that uses **Supabase's OAuth 2.1 server** for authentication. Supabase hosts `/authorize`, `/token`, `/register`, and `.well-known` discovery on its own infrastructure — this template only hosts the sign-in + consent screens on your domain, and verifies the resulting JWTs. Google and GitHub social login are wired up out of the box, and the pages ship with a polished shadcn-style UI.

## Features

- **Supabase-hosted OAuth 2.1 server** — Supabase handles registration, authorization, token issuance, and discovery
- **Custom sign-in + consent UI** — React + Tailwind, server-rendered with no bundler; `src/auth-routes.ts` wires it up
- **Google + GitHub social login** — drop in provider credentials in the Supabase dashboard and both buttons work
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

### 3. Enable Google and GitHub providers

In the Supabase Dashboard under **Authentication** → **Providers**, enable the providers you want to support:

- **Google** — create an OAuth client at <https://console.cloud.google.com/apis/credentials>. Paste the client ID / secret into the Supabase provider settings. You only need Google OR GitHub for the template to work; the sign-in page shows both buttons.
- **GitHub** — create an OAuth app at <https://github.com/settings/developers>. Paste the client ID / secret into the Supabase provider settings.

Then add this callback URL to the **allowed redirect URLs** for each provider (in Auth → URL Configuration):

```
http://localhost:3000/auth/callback
```

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
# MCP_USE_OAUTH_SUPABASE_SITE_URL=http://localhost:3000   # only needed behind a proxy
```

### 6. Install and run

```bash
pnpm install
pnpm dev
```

`pnpm dev` compiles the Tailwind stylesheet into `public/styles.css` and then starts the MCP server on port **3000**. During active UI development, run `pnpm dev:css` in a second terminal for a Tailwind watcher.

The inspector is at <http://localhost:3000/inspector>.

## Try it out

1. Open <http://localhost:3000/inspector>
2. Connect to `http://localhost:3000/mcp`
3. Inspector triggers the OAuth flow — Supabase redirects you to `/auth/consent` here
4. Click **Continue with Google** or **Continue with GitHub**, complete the provider's flow
5. Click **Approve** on the consent page
6. Back in the inspector, call:
   - `get-user-info` — returns your user id and email
   - `list-notes` — returns your notes (requires the table from step 4)

## Available tools

| Tool            | Description                                                |
| --------------- | ---------------------------------------------------------- |
| `get-user-info` | Returns the authenticated user's id and email              |
| `list-notes`    | Reads the user's `notes` rows via Supabase (RLS-protected) |

## How the OAuth flow works

```
MCP Client ──(1) MCP request without token ─▶ MCP Server ──▶ 401 + WWW-Authenticate
MCP Client ──(2) GET /.well-known/oauth-protected-resource ─▶ MCP Server
MCP Client ──(3) GET /.well-known/oauth-authorization-server ─▶ Supabase
MCP Client ──(4) Dynamic Client Registration ─▶ Supabase
MCP Client ──(5) GET /authorize ─▶ Supabase ──▶ redirect to /auth/consent (this server)
              ──▶ user signs in via Google/GitHub (through Supabase Auth)
              ──▶ /auth/callback exchanges the code, sets the session cookie
              ──▶ /auth/consent renders; user approves scopes
              ──▶ /auth/consent POSTs back to Supabase ──▶ redirect to MCP client with code
MCP Client ──(6) Token exchange ─▶ Supabase
MCP Client ──(7) MCP request + Bearer <jwt> ─▶ MCP Server (verifies via Supabase JWKS)
```

## Customizing

### The UI

- Sign-in page: `src/views/sign-in.tsx`
- Consent page: `src/views/consent.tsx`
- Shared UI primitives: `src/components/ui/*`
- Global styles / design tokens: `src/styles.css` (compiled to `public/styles.css` on build)

The pages are plain React components server-rendered via `renderToString`. If you add new classes, the Tailwind watcher (`pnpm dev:css`) will recompile `public/styles.css`.

### Add more providers

Supabase supports many OAuth providers natively. To add another (e.g. Azure, Apple, Discord):

1. Enable it in the Supabase Dashboard under Auth → Providers.
2. Add the provider id to the `PROVIDERS` list in `src/auth-routes.ts`.
3. Add a matching button in `src/views/sign-in.tsx`.

## Deploy

```bash
npx mcp-use deploy
```

Before deploying:

1. Update the consent screen URL in the Supabase Dashboard to your deployed URL (e.g. `https://your-app.run.mcp-use.com/auth/consent`).
2. Update each enabled provider's allowed redirect URL to match `<your-host>/auth/callback`.
3. Set `MCP_USE_OAUTH_SUPABASE_SITE_URL` to your public URL so OAuth callbacks compose correctly.
4. For the `list-notes` example, ensure your RLS policies are correct for your data model.

## Troubleshooting

- **"Unsupported provider: …"** — only `google` and `github` are enabled by default. Add more to `PROVIDERS` in `src/auth-routes.ts`.
- **"Failed to start {provider} sign-in"** — the provider is not enabled in the Supabase dashboard, or the callback URL isn't whitelisted. Enable it under Auth → Providers and add `<SITE_URL>/auth/callback` to the allowed redirect URLs.
- **PKCE / "code verifier missing"** — a cookie was dropped between `/auth/signin/:provider` and `/auth/callback`. Make sure the browser's cookies for your domain aren't being blocked, and that `MCP_USE_OAUTH_SUPABASE_SITE_URL` matches the host the browser sees.

## Learn more

- [Supabase OAuth Server guide](https://supabase.com/docs/guides/auth/oauth-server)
- [Supabase Auth docs](https://supabase.com/docs/guides/auth)
- [mcp-use docs](https://mcp-use.com/docs)
- [MCP Authorization spec](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)

## License

MIT
