# WASH Connect API

Notes on the WASH Connect (WASH Multifamily Laundry) cloud API, learned by
poking at the live backend and building against it. Builds on the
reverse-engineered reference in [yostinso/wash-connect](https://github.com/yostinso/wash-connect/blob/main/WASH_API.md);
this file records what I verified first-hand plus a few things that doc didn't cover.

## Backend

All endpoints below live on the Firebase Cloud Functions backend:

```
https://us-central1-washmobilepay.cloudfunctions.net
```

Every request needs a `provider: kiosoft` header. Authenticated requests also
need `Authorization: Bearer <token>` from `/login`.

A second backend (`https://www.getwashconnect.com/api/`) handles auto-refill and
extended account info via a separate `user_token` (`POST /get_token`). I didn't
need it — everything I wanted is on the Firebase backend.

## Script policy (be a good upstream citizen)

This is someone else's production backend. Any script that hits it must:

- **Cap at ~5 requests/sec per script** — no bursts, no parallel fan-out that
  exceeds it. The geo-index sweeps are bulk reads of a third-party API; pace them.
- **Cache results to disk and never re-fetch a known code** (including 404s), so
  a rerun costs nothing upstream.
- **Get Colin's code review before running any new or updated script** that
  calls this API. Prepare and verify the script, then ask — don't run first.

## Endpoints

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/locations?srcode=<srcode>` | GET | none | Resolve a site code → location + ULN |
| `/get_machine_status_v1?uln=<uln>` | GET | none | Live status of all machines |
| `/login` | POST | none | Email/password → bearer token + balance |
| `/machine_history` | GET | **bearer** | The caller's own cycle history |
| `/account_balance` | GET | bearer | Current balance (cents, integer) |

`/locations` and `/get_machine_status_v1` are **public** — no login needed just
to see what's available in a room, given its site code or ULN.

### `GET /locations?srcode=<srcode>`

`srcode` is the site code on the laundry-room signage (e.g. `wsh3345`, `W001274`).
Returns `{ "status": 200, "location": { uln, location_name, location_id, ... } }`.

> ⚠️ **The `uln` comes back with trailing whitespace** (e.g. `"CA7521809   "`).
> Always `.strip()` it before using it in other calls.

> ⚠️ **`device_type` tells you whether live machine status is even
> available.** The value is the installed KioSoft reader tier — KioSoft (the
> `provider: kiosoft` backend, now PayRange) sells a reader line marketed as
> "Prime Connect Select." Three values observed across ~17.5k cached rooms:
> **`prime`** (62.5%), **`connect`** (33.2%), and **`ultra`** (4.3%) — no
> others. (We never saw a literal `select`.) It is **load-bearing for
> `/get_machine_status_v1`:**
>
> - **`prime`** and **`ultra`** → publish live per-machine status (the endpoint
>   returns populated floors). Verified: `prime` sites returned 3–24 machines
>   each; sampled `ultra` sites returned 2–32 (one incidental 0, the same way a
>   `prime` room can momentarily report nothing).
> - **`connect`** → **never returns machines.** `get_machine_status_v1` responds
>   `{ "status": "ok", "data": {} }` — empty, no error — for every `connect`
>   site. It's payment-only hardware that doesn't report occupancy. All sampled
>   `connect` sites returned 0. `connect` rooms also tend to be tiny (room
>   `range` like `1-2`) vs `prime` (`1-255`).
>
> So an empty `data: {}` is **indistinguishable from "all machines offline"
> unless you check `device_type` first.** Resolve `device_type` from
> `/locations` and treat **`connect`** — the only non-publishing tier — as "no
> live status available" rather than "no machines free." Gate on
> `device_type === "connect"` specifically, **not** `!== "prime"`: the latter
> would wrongly flag the ~750 `ultra` rooms that do report status.

### `GET /get_machine_status_v1?uln=<uln>`

Returns `{ "data": { "<floor>": { "name": ..., "machines": [...] } } }`, floors
keyed by numeric string. Machine fields: `machine_number`, `bt_name`, `type`
(`washer`/`dryer`), `status` (`available` / `in_use` / `out_of_service`),
`time_remaining` (minutes), `start_time` (ISO 8601 UTC), `last_user`.

Two quirks, both real and both must be handled:

> ⚠️ **`status` gets stuck on `in_use` after a cycle ends.** Seen live: a dryer
> reporting `in_use` with a `start_time` **3 days old**. Don't trust `status`
> alone. Compute `start_time + time_remaining`; if that moment has passed, treat
> the machine as **available**. `time_remaining` is a snapshot from cycle start,
> not a live countdown, so pair it with `start_time` for any real estimate.

> ⚠️ **The same `bt_name` can appear on multiple floors** with identical data.
> Deduplicate by `bt_name` (first occurrence wins) when flattening.

> ⚠️ **Cycles can start without ever reaching the cloud.** Verified live
> 2026-06-11: a dryer was physically mid-cycle while the backend still
> reported a `start_time` three days old — the new cycle never registered.
> It's intermittent per cycle, not a fixed trait of the machine: the same
> dryer that failed to report that cycle reported its next one (the
> following day) within minutes, and a washer's cycle the same day also
> showed up promptly. Consequence: a machine whose computed end has passed
> may be *occupied*, not free, and nothing in the API can distinguish the
> two.

> ✅ **Extensions update `time_remaining` (verified 2026-06-11).** A dryer
> started for 45 min and immediately extended by 5 reported
> `time_remaining: 51` — the extension is folded into `time_remaining`
> (plus what looks like a spare rounding/buffer minute), while `start_time`
> stays at the original cycle start. So `start_time + time_remaining`
> remains a correct end estimate after an extension. There's still no
> extension *flag* here — machines expose exactly seven fields
> (`machine_number`, `bt_name`, `last_user`, `start_time`, `status`,
> `time_remaining`, `type`); the `extended` field exists only on the auth'd
> `/machine_history`, own cycles only. Only an extension made right at
> cycle start has been observed; a mid-cycle extension presumably bumps
> `time_remaining` the same way, visible on the next poll.

> ⚠️ **Machines can run past the estimate even without an extension.**
> Machines sometimes decide to run a few minutes longer than
> `start_time + time_remaining` (observed at the reference site). Treat the
> computed end as a soft estimate with a few minutes of slack — arriving
> exactly at the computed end, you may find the machine still finishing.

### `POST /login`

Body: `{ "login": "<email>", "password": "<plaintext>", "isEncrypted": false }`.
The app also supports CryptoJS-AES encrypted passwords (`isEncrypted: true`), but
plaintext works and is simpler. Returns `token`, `user_id` (numeric string),
`last_uln`, `account_balance` (cents, **as a string** here).

Bad credentials return **HTTP 400**, not 401.

### `GET /machine_history`

Requires a bearer token. **Important scope limitation:** it returns only the
**authenticated user's own cycles** — not building-wide occupancy. I confirmed
this: 121 records over ~18 months all carried my single `user_id`. Query params
(`?uln=`, `?user_id=`) made no difference to the result; it's keyed to the token.

Response shape — an object keyed by opaque push IDs:

```json
{
  "machine_history": {
    "-OBTArukySd4KDPbRIiT": {
      "timestamp": "2024-11-12T02:24:09.246Z",
      "event": "start-cycle-extended",
      "state": "in_use",
      "machine_name": "002",
      "machine_id": "20wsh3345161876002",
      "machine_type": "dryer",
      "duration": 45,
      "vend_price": "2.25",
      "extended": "normal",
      "location": "wsh3345",
      "uln": "CA7521809",
      "user_id": "000001760227",
      "device_id": "67E6C20D-..."
    }
  }
}
```

Every record I saw was `event: "start-cycle-extended"`, `state: "in_use"` — i.e.
one row per cycle the user *started*. `duration` is the cycle length in minutes;
`vend_price` is a dollar string. To get chronological order, sort values by
`timestamp` (the push-ID keys are roughly time-ordered but don't rely on it).

So: **good for visualizing your own laundry habits, not for predicting when the
room is busy.** Building-wide occupancy would require polling
`/get_machine_status_v1` over time and storing snapshots yourself.

## Building a geo index (future work)

The API has **no geo endpoint** — no "nearby," no lat/lng, no way to go from a
GPS fix to a site code. But the site codes are enumerable and each carries an
address, so a `{ srcode → address → lat/lng }` table can be built offline and
queried for "nearest WASH room to me." None of this needs auth.

### Site-code namespaces

Site codes (`srcode`) are **7 characters** (matches WASH's "7-digit location
code" FAQ) and **case-insensitive** (`w001274` ≡ `W001274`, `WSH3345` ≡
`wsh3345`). Two namespaces are confirmed live, both far smaller in practice than
their theoretical keyspace:

| Namespace | Format | Populated range | Density | ~Codes |
|-----------|--------|-----------------|---------|--------|
| `wsh####` | `wsh` + 4 digits | `wsh0000`–`wsh9999` | ~95% | ~10k |
| `W######` | `W` + 6 digits | `W000001`–`~W015000` | ~95–100% | ~15k |

So the **real search space is ~25k codes, not 1M+.** Measured facts:

- **`wsh####`** — exactly 4 zero-padded digits. Non-4-digit variants 404
  (`wsh1`, `wsh100`, `wsh10000` fail; `wsh0001`, `wsh0100` succeed). Sampled hit
  rate ~95–100% across `wsh0000`–`wsh2149`.
- **`W######`** — exactly 6 zero-padded digits (`W00001` and `W0012740` 404).
  Densely filled from `W000001` to a **hard cliff at ~`W015000`–`W016000`**: a
  20-code window march read 20/20 through `W014000` then dropped to 0/20 at
  `W016000` and stayed ~empty up to `W040000` (one lone straggler at `W026000`).
  A coarse grid every 10–50k across the full `W000000`–`W999999` range hit
  *nothing* except `W010000`. So the populated `W` band is a compact low region,
  not spread across the namespace.
- **The address rides in `location_name`.** `address_line1` / `address_line2`
  come back `null`, but `location_name` is the street address itself
  (`"20 Crestline Dr"`, `"12536 Pacific Ave"`). The ULN's two-letter prefix
  encodes the state, which is enough to disambiguate the geocode region even
  though city/zip aren't returned.

> ⚠️ **Don't confuse WASH codes with other vendors' app codes.** University
> "location pins" found online — `W10047` (UW-Milwaukee), `NCSU01` (NC State),
> `UNHCAT` (UNH) — are **Speed Queen / other apps**, not WASH-Connect; all 404
> against this API. Only `wsh####` and `W######` have hard evidence.

### Codes are batched, not sequential

A code's *number* tells you roughly where its batch sits, but **not** its age or
a clean global order. Evidence from ~3.4k cached `wsh` records:

- **`location_id` (the true creation counter, range 1–9572) only loosely tracks
  code order** — Pearson r ≈ 0.36, 86% of adjacent pairs increasing. Whole
  contiguous runs go *backwards* (`wsh1721`–`wsh1725` → `location_id`
  1374→1368).
- **Creation timestamps interleave** — newer sites are backfilled into gaps
  among older ones (`wsh3448` is a 2021 site, `location_id` 8443, wedged between
  2019 neighbors). A code number doesn't imply when it was issued; empty slots
  get reused years later.
- **But locally clustered:** mean same-state run length ~13.6, and ~93% of
  adjacent codes share a state. Codes are issued in contiguous
  geographic/account batches (e.g. a numbered run of Saint Johns Blvd
  addresses), so a block of consecutive codes tends to be one property batch in
  one area. You **can** exploit local clustering; you **cannot** extrapolate
  across blocks or infer age.

### State / country distribution

The ULN prefix is a **state/province** code, not a country — WASH runs in the US
+ all Canadian provinces, and the API returns no country field. Of the first
~2.1k `wsh` codes: ~88% `CA` (California), then `AZ`/`MI`/`IL`/`TX`/`WA`/`HI`/…
all US; **no Canadian provinces seen yet** in the low `wsh` band (expect
`ON`/`BC`/`AB`/`QC`/… higher up). Two gotchas when geocoding:

- **`CA` is ambiguous** — here it's California (US state), but as a country code
  it's Canada. Expand the prefix to a full region before geocoding
  (`"CA" → "California, USA"`, `"ON" → "Ontario, Canada"`).
- **Infer country from the prefix** via the fixed 13-code Canadian-province set
  (`AB BC MB NB NL NS NT NU ON PE QC SK YT`); everything else is the US. Filter
  junk/test prefixes (`TE`, `00`, `01`, `ER`, …) before geocoding.

### Sketch

1. **Dense-sweep the known bands** — `wsh0000`–`wsh9999` and `W000000`–`W016000`
   — calling `GET /locations?srcode=<code>` for each (~25k requests).
2. **Coarse-grid the rest as insurance** — probe `W` every ~500–1000 above the
   known edge up toward `W999999`. Any hit reveals an outlier band; locally
   expand around it until it goes dry (loop-until-dry). This catches stragglers
   without paying for the empty ~98% of the namespace. Re-probe the frontier
   (`W015000`–`W020000`) periodically — the cliff creeps up as WASH grows.
3. For each `status: 200`, record `{ srcode, uln (stripped), location_name,
   state := uln[:2] }`. **Drop sentinels** — `wsh0001` is a test record
   (`"WASH Test"`, ULN `TEST12345`, 9 rooms); also drop junk ULN prefixes.
4. Geocode `location_name + ", " + region` (expanded, see above) → one or more
   `(lat, lng)` candidates.
5. Optionally attach machine counts/types per site via
   `GET /get_machine_status_v1?uln=<uln>`.

> Note: ~25k (`wsh` ~10k + `W` ~15k) is well short of WASH's ~70k-rooms figure.
> Either more prefixes exist, the `W` space has sparse sub-bands above the cliff,
> or the 70k marketing number includes legacy/non-app locations. The coarse-grid
> insurance pass is how you'd discover any hidden bands.

### Ambiguous addresses → keep all candidates

`location_name` is just a street line with no city/zip, so a single string can
match multiple real places — e.g. there are two `1824 W Neighbor Ave` in
California. **Don't try to pick the "right" one.** Store every geocoder candidate
for that `srcode` as a potential location:

```
srcode wsh3000 → [ (lat1, lng1), (lat2, lng2), ... ]
```

A nearest-WASH lookup still works fine: compute the distance from the user to
*every* candidate across *every* srcode and return the closest. An ambiguous
site simply contributes several points instead of one; whichever candidate is
actually nearest the user is the one that surfaces, and the wrong twin is just a
distant point that never wins. Precision only matters once two candidates of the
*same* srcode are both plausibly nearby, which is rare for street addresses.

### Caveats

- **This is a bulk scrape of ~25k+ street addresses** (often the building
  address) over an unauthenticated endpoint. Fine for a personal "nearest room"
  tool; don't republish the raw dataset. Follow the
  [Script policy](#script-policy-be-a-good-upstream-citizen) above (≤5 RPS,
  cache, code review first).
- Hit rates, band edges, and the batched-not-sequential findings were **sampled,
  not exhaustively verified** — confirm with a full sweep before trusting
  coverage numbers, and re-check the `W`-band cliff over time (it moves).

## Misc

- The APK bundles a public Firebase web API key (`AIzaSy...`) and a secondary-API
  key. Neither is needed for any Firebase Cloud Functions endpoint above.
- Some endpoints embed an error status in the body (`{"status": 401, ...}`) even
  on an HTTP 200, so check both.

## Reference site

`wsh3345` → ULN `CA7521809`, "20 Crestline Dr", one room `LR001`:
washer `#001`, dryers `#002` and `#003`.
