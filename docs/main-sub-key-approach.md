# Main/Sub Key Security POC Approach

## Problem and requirements

This POC issues one public `main-key` pair and one-time `sub-keys` (initially 10; more can be issued or replaced without rotating the main key).
It must support:

- sharing the main key publicly in long or short form
- mapping any sub key back to its main key (server-side; not exposed in minimal API responses)
- consuming sub keys exactly once; revoking unconsumed sub keys when reissuing
- resolving either key type from scan or manual input
- mobile-friendly UI
- Turso database
- Netlify hosting

## Threat model

This POC focuses on practical misuse paths:

1. Tampering: someone edits a key string and tries to make it valid.
2. Replay: someone reuses a consumed sub key.
3. Enumeration: someone guesses random strings and hits the API (mitigated by stronger sub-key entropy; production still needs rate limiting and auth at the edge).
4. Data mismatch: payload says one identity, DB says another.

## Why this design

The system uses two independent checks:

1. Cryptographic integrity
  - Long main keys are signed with an HMAC-derived signature.
  - Short main keys are deterministically derived from long keys using HMAC.
  - Sub keys (current format) use a random base32 body plus an HMAC-derived signature fragment (not a single checksum digit).
2. Database truth in Turso
  - DB is authoritative for ownership, generation, revocation, and one-time consumption.
  - Atomic update (`consumed_at IS NULL` and `revoked_at IS NULL`) prevents double consumption and use after revoke.

This is not fancy architecture. It is simple, explicit, and hard to break accidentally.

## Key format

- Main key (long): `MK` + 18 base32 chars + 8-char signature
- Main key (short): 12 base32 chars (11 body + 1 HMAC checksum digit, derived from long key)
- Sub key (current): `S` + 10 random base32 chars + 4-char HMAC-derived signature (Crockford base32: `A–Z` and `2–7`)
- Sub key (legacy, still accepted): 6 numeric digits (`5 random + 1 HMAC checksum digit` under namespace `sub-legacy`)

Important property:

- A short main key is generated from the long main key via HMAC.
- Without the long key (and server secret), the short key cannot be generated.

## Data model (Turso/SQLite)

### `main_keys`

- `id` text primary key
- `public_key` unique text (long main key)
- `short_key` unique text (derived short main key)
- `current_generation` integer (incremented on `replace` reissue strategy)
- `created_at`

### `sub_keys`

- `id` text primary key
- `main_key_id` foreign key to `main_keys.id`
- `public_key` unique text
- `generation` integer (ties sub keys to a reissue batch; aligns with `main_keys.current_generation` after replace)
- `consumed_at` nullable timestamp
- `consumed_via` enum-like text (`scan`, `manual`, `main-selection`)
- `revoked_at`, `revoked_reason` nullable (set when active keys are revoked during replace)
- `created_at`

### `audit_events`

- `id` text primary key
- `event_type` text (`resolve`, `consume`, `issue`, `revoke`)
- `outcome` text (e.g. `ok`, `ok_main`, `ok_sub`, `tampered`, `not_found`, `already_consumed`, `revoked`, `error`)
- `main_key_id`, `sub_key_id` nullable (foreign keys where applicable)
- `key_hash` nullable (HMAC of normalized key material for correlation without storing raw keys)
- `actor_hash` nullable (hash of client IP from `X-Forwarded-For` / `X-Real-IP`)
- `meta_json` text (structured context, e.g. `via`, `strategy`, counts)
- `created_at`

Indexes:

- `sub_keys(main_key_id)`, `sub_keys(consumed_at)`, `sub_keys(main_key_id, generation)`, `sub_keys(revoked_at)`
- `audit_events(event_type, created_at)`, `audit_events(main_key_id, created_at)`, `audit_events(sub_key_id, created_at)`

## API surface

Responses follow a **least-privilege** rule: public resolve/consume paths do not return full key strings, internal IDs beyond what the UI already needs, or timestamps that are not required for the immediate action.

- `POST /api/keys/generate`  
  - Creates main key and 10 sub keys (unchanged for bootstrap).

- `POST /api/keys/resolve`  
  - Detects key type, verifies format/signatures, checks DB.  
  - **Main success:** `{ type: "main", mainId }` only (no long/short key echo).  
  - **Sub success:** `{ type: "sub", mainId, consumed, revoked, generation }` (no raw sub key or `subId` in response).

- `POST /api/keys/consume`  
  - Consumes sub key atomically; `409` with `already_consumed` or `revoked` when applicable.  
  - **Success:** `{ status: "consumed", consumedAt }` (no `mainId`/`subId` in response).

- `GET /api/keys/main/[mainId]/subkeys`  
  - Returns `mainId`, optional `mainShortKey`, and the list of sub keys with status fields (does **not** return the main long key).

- `POST /api/keys/main/[mainId]/subkeys/issue`  
  - Body: `count` (1–100), `strategy` `append` | `replace`, optional `reason`.  
  - **Append:** inserts new sub keys at current generation.  
  - **Replace:** in a single DB transaction: bump `current_generation`, revoke all unconsumed non-revoked sub keys for that main, then insert the new batch. On failure, transaction rolls back (no partial generation bump without matching intent).  
  - Response includes `issued`, `issuedCount`, `currentGeneration`, `revokedCount` (replace path).

## UI flow

Single mobile-first page:

1. Generate main + sub keys (long main and sub QRs shown from generate response).
2. Show QR for main and each sub key.
3. Scan or type a key.
4. If main key: resolve returns `mainId` only; client loads sub keys via `GET .../subkeys` (short main shown from that response when available).
5. If sub key: consume immediately and refresh state.
6. Optional: issue more sub keys or revoke active + reissue (`replace`) without changing the main key.

## Environment variables

- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
- `KEY_SIGNING_SECRET`

## Netlify deployment notes

1. Connect repository in Netlify.
2. Set environment variables in Netlify UI.
3. Use `netlify.toml` with `@netlify/plugin-nextjs`.
4. Build command: `npm run build`.

## Production reminders (outside POC scope but mandatory for public APIs)

- Authenticate and authorize `generate`, `subkeys`, and `issue` (and usually `consume`/`resolve` if abuse-sensitive).
- Rate limit resolve/consume at the edge; monitor `audit_events` for enumeration patterns.

## Why not over-engineer this

- No extra queue/worker complexity for a straightforward key lifecycle.
- No heavy abstraction layers for DB access.
- Explicit API paths are easier to debug in production.
- Security checks happen in a strict order and fail closed.
- Sub keys are stronger than legacy numeric codes while staying QR-friendly; DB remains source of truth for one-time use and revocation.
