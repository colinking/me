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

### Why it's feasible

- **`wsh####` is a dense, 4-digit keyspace.** Valid codes are `wsh` + a
  zero-padded 4-digit number (`wsh0000`–`wsh9999`, ~10k total). Non-4-digit
  variants 404 (`wsh1`, `wsh100`, `wsh10000` all fail; `wsh0001`, `wsh0100`
  succeed). Sampled hit rate inside the range was ~100%, so a full sweep is
  ~10k cheap, unauthenticated `GET /locations` calls. This is one prefix family;
  other prefixes exist (e.g. `W001274`) and would each be their own sweep. WASH's
  ~70k-rooms-total figure spans all prefixes, not just `wsh`.
- **The address rides in `location_name`.** `address_line1` / `address_line2`
  come back `null`, but `location_name` is the street address itself
  (`"20 Crestline Dr"`, `"12536 Pacific Ave"`). The ULN's two-letter prefix
  encodes the state (`CA…` → California, `MI…` → Michigan), which is enough to
  disambiguate the geocode region even though city/zip aren't returned.

### Sketch

1. Sweep `wsh0000`–`wsh9999` (and any other known prefixes), calling
   `GET /locations?srcode=<code>` for each.
2. For each `status: 200`, record `{ srcode, uln (stripped), location_name,
   state := uln[:2] }`. **Drop sentinels** — `wsh0001` is a test record
   (`"WASH Test"`, ULN `TEST12345`, 9 rooms).
3. Geocode `location_name + ", " + state` → one or more `(lat, lng)` candidates.
4. Optionally attach machine counts/types per site via
   `GET /get_machine_status_v1?uln=<uln>`.

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

- **This is a bulk scrape of ~10k+ street addresses** (often the building
  address) over an unauthenticated endpoint. Fine for a personal "nearest room"
  tool; rate-limit politely, and don't republish the raw dataset.
- Hit rate and keyspace shape were sampled, not exhaustively verified — confirm
  with a full sweep before trusting coverage numbers.

## Misc

- The APK bundles a public Firebase web API key (`AIzaSy...`) and a secondary-API
  key. Neither is needed for any Firebase Cloud Functions endpoint above.
- Some endpoints embed an error status in the body (`{"status": 401, ...}`) even
  on an HTTP 200, so check both.

## Reference site

`wsh3345` → ULN `CA7521809`, "20 Crestline Dr", one room `LR001`:
washer `#001`, dryers `#002` and `#003`.
