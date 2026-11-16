# Running Front Office on your own machine

Front Office was built on Replit, which quietly supplies four things: Node,
a Postgres database, the routing that sends `/api` to the API server, and the
Clerk keys. This page is what replaces them on a Mac or Linux machine.

Checked on Linux with Node 24.22, pnpm 11.28 and Postgres 16: install,
typecheck, both test suites, and the app starting and answering through the
proxy. The macOS steps are the same but have not been run on a Mac yet.

## One-time setup

1. Install Node 24 (see `.nvmrc`), pnpm 11, and Postgres 16 with `psql` on
   your PATH.
2. `pnpm install`
3. `createdb frontoffice_dev`
4. `cp .env.local.example .env.local`, then fill in the two Clerk keys from
   your own Clerk application's Development instance.
5. In the Clerk dashboard, open **Sessions > Customize session token** and save
   these claims, so the API gets your email and name on every request:

   ```json
   {
     "email": "{{user.primary_email_address}}",
     "firstName": "{{user.first_name}}",
     "lastName": "{{user.last_name}}",
     "imageUrl": "{{user.image_url}}"
   }
   ```

   Replit's Clerk instance had these already. Without them a first sign-in
   still works: the API reads the profile from Clerk's API once to create your
   account. Production needs the same claims on its Clerk instance.

## Every day

```
./scripts/dev-local.sh
```

Then open http://localhost:4100. The script loads `.env.local`, brings the
database schema up to date, and starts the API and the web app together.
Ctrl-C stops both.

## What is different from Replit

| On Replit | On your machine |
| --- | --- |
| The workspace router sends `/api` to the API server | Vite proxies `/api` when `API_PROXY_TARGET` is set; the script sets it |
| Clerk keys come from the workspace's Auth pane | Keys from your own Clerk application, in `.env.local` |
| Postgres comes from the Replit database module | Local Postgres 16; `scripts/apply-schema.sh` builds the schema |
| Only linux-x64 build binaries are installed | `pnpm-workspace.yaml` also allows darwin-arm64 (Apple Silicon) |

`.env.local` is git-ignored. Keep real keys there and nowhere else.

## Running the tests

```
createdb frontoffice_test
export DATABASE_URL=postgresql://localhost:5432/frontoffice_test
./scripts/apply-schema.sh
pnpm --filter @workspace/api-server run test
pnpm --filter @workspace/front-office run test
```

The API tests need `CLERK_SECRET_KEY` and `CLERK_PUBLISHABLE_KEY` set to any
validly formatted keys; `.github/workflows/ci.yml` shows the fake pair CI uses.
