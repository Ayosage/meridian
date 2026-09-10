# Discord launch contract (Meridian ↔ steward)

Goal: a `/catan` slash command in steward (the Discord bot,
`webdev/steward`) creates a Meridian match and posts a join link; up to 8
people click through into seats. The contract between the projects is kept
deliberately thin — one endpoint plus a join-URL format — so each side can
be built and tested alone.

Status 2026-08-26: Meridian half implemented (endpoint, ?join= client path,
expiry, seatNames, container/fly scaffolding — deployment itself pending).
`players` accepts 3..8 (the 8-player build landed first). Steward half
pending. Update 2026-09-02: the server Docker image builds and runs locally
(`docker build -f apps/server/Dockerfile .` from the repo root, 518MB);
`GET /__healthcheck` (from @colyseus/tools) answers 200 and `POST /matches`
returns a room code — see BACKLOG "Infra / follow-ups".

## The contract (v0)

### 1. Create-match endpoint (Meridian server)

```
POST /matches
Authorization: Bearer <LAUNCH_TOKEN>
Content-Type: application/json

{ "players": 4, "bots": 0, "seatNames": ["Alice", "Bob"] }
```

- `players`: seat count. v0: `3 | 4` (what CatanRoom accepts today); rises
  with the 8-player build (see BACKLOG).
- `bots` (optional, default 0): native-bot seats, same as the lobby picker.
- `seatNames` (optional): Discord display names to pre-label seats as
  humans arrive, first-come first-named. Purely cosmetic in v0.

Response `201`:

```
{ "code": "ABCD", "joinUrl": "https://<client-origin>/?join=ABCD", "expiresAt": "<ISO8601>" }
```

- `code` is the Colyseus roomId (the same short code the lobby shows).
- Errors: `401` bad/missing token, `422` bad player/bot counts, `503` at
  room capacity.

Implementation home: `initializeExpress` in `apps/server/src/app.config.ts`
(@colyseus/tools supports HTTP routes next to the game server). The room is
created unowned — the first human to join becomes host, exactly like a
lobby-created room whose creator left.

### 2. Join URL (Meridian client)

`<client-origin>/?join=<CODE>` — the client reads `?join` at boot and goes
straight to the join flow with the code prefilled (today the lobby only
accepts a hand-typed code; this query-param path is the new piece). Invalid
or expired code falls back to the normal lobby with an error toast.

### 3. Lifecycle

- A launched room that nobody has joined disposes after 30 minutes
  (`expiresAt` in the response is that deadline).
- Once seated, normal room rules apply (Colyseus disposes empty rooms).

## What each side needs

Meridian (all server/client work, no steward dependency):
- [x] `POST /matches` route + `LAUNCH_TOKEN` env + room-expiry timer
- [x] Client `?join=` boot path
- [ ] Public deployment (server WS + client origin; steward is Fly-oriented
      — Fly works for both; Dockerfile + fly.toml scaffolded in apps/server)
- [x] 8-player build raises the `players` ceiling to 3..8

Steward (one plan task, no Meridian dependency once the contract is fixed):
- [ ] `/catan players:<n> bots:<n>` command → `POST /matches` → embed with
      join link + code
- [ ] Env: `MERIDIAN_API_URL`, `MERIDIAN_LAUNCH_TOKEN`

## Non-goals for v0

Turn/result notifications back to Discord, seat reservations bound to
Discord identities, spectator links, multi-match tracking per guild. All
possible later over the same endpoint style; none constrain v0.
