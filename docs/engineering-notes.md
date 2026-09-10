# Engineering notes

This document records the tradeoffs behind the seating map's performance-critical decisions, and
the bottlenecks they leave in place. It's aimed at anyone extending this codebase who needs to know
_why_ something works the way it does before changing it.

## Why section-level collapsing instead of a virtualization library

`react-window`/`react-virtualized` virtualize a linear (or grid) list by only mounting the rows
currently in the scroll viewport. That model doesn't map cleanly onto this venue: seats are laid
out on radial rows around a stage (see [`scripts/generateVenue.ts`](../scripts/generateVenue.ts)),
not a scrollable list, and the interaction unit users care about is a **section**, not a row.

Instead, [`Section.tsx`](../src/components/Section.tsx) renders each inactive section as a single
collapsed `<path>` and defers mounting any seat nodes until the user clicks into it. This is simpler
than adapting a list-virtualization library to a 2D radial layout, needs no extra dependency, and
naturally matches the venue's real-world browsing pattern (pick a section, then pick a seat).

**Bottleneck this leaves in place:** the _active_ section still mounts all of its seats at once
(~1,500 in the current 10×30×50 sample venue). That's fine at this scale, but a venue with, say,
5,000 seats in a single section would need row-level virtualization _within_ the active section -
this codebase doesn't have that yet.

## Why SVG over Canvas/WebGL

SVG gives native accessibility (`role`, `aria-*`, real DOM focus) and hit-testing for free - every
seat is a real, individually focusable element without any custom hit-testing code. Canvas/WebGL
would render faster at very large scale, but every one of those things (focus order, screen-reader
semantics, click targets) would need to be reimplemented by hand against an off-screen model.

**Where this stops scaling:** SVG's per-node overhead (DOM presence, style recalculation, event
listener) becomes the bottleneck somewhere in the tens-of-thousands of simultaneously-mounted
nodes - this project stays well under that by only ever mounting one section's seats. If a future
requirement needs _all_ sections' seats interactive simultaneously (e.g., a full-venue heatmap),
that's the point to reach for Canvas with a manual hit-testing layer, or a WebGL instanced-rendering
approach, accepting the accessibility rebuild that comes with it.

## `memo()` boundaries and render cost

`Section` and `Seats` (in [`Seat.tsx`](../src/components/Seat.tsx)) are both `React.memo`-wrapped so
that panning/zooming or selecting a seat in one section doesn't re-render every other section's
already-collapsed cover path. Per-seat fill/stroke/text-color used to be recomputed via an if/else
ladder on every render; [`seatStatus.ts`](../src/utils/seatStatus.ts)'s `SEAT_STATUS_STYLE` replaced
that with a lookup keyed by effective status, computed once at module scope. The one thing that
lookup can't express is that an _available_ seat's stroke also depends on its own price tier -
`Seat.tsx` still applies that as a small override after the lookup.

A second render-cost fix landed alongside the live-hold work: `Seats` used to subscribe to the raw
`zoom` number just to derive a `showLabels` boolean, which meant all ~1,500 mounted seats re-rendered
on _every_ wheel/zoom event regardless of whether the threshold was actually crossed. It now
subscribes to `zoom >= LABEL_ZOOM_THRESHOLD` directly - a boolean that only changes value when the
threshold is crossed, so Zustand's default `Object.is` equality skips the re-render otherwise. This
was a prerequisite for adding the `holds`/`simulationSeeded` subscriptions the resolver needs,
not just a nicety on its own.

## `localStorage` persistence limits

[`seatStore.ts`](../src/store/seatStore.ts) persists `selectedSeats`, `soldSeats`, `bookings`, and
`selectionExpiresAt` to `localStorage` via a custom `PersistStorage` that serializes `Set<string>`
to a plain array. This is enough for the current scope (survive a page refresh, single device, no
login) but has real limits:

- `localStorage` has a per-origin size ceiling (typically ~5–10MB depending on browser) - irrelevant
  at 8 selected seats, but the pattern shouldn't be reused to persist large datasets.
- No cross-device sync - a selection doesn't follow a user to a different browser or device, and
  there's no server-side inventory, so two different people (or the same person on two devices)
  could still both believe they've bought the same seat.
- **Cross-_tab_ contention on one browser is now handled** (not cross-device) - see
  [`holdProtocol.ts`](../src/utils/holdProtocol.ts) and the "Live seat-hold contention" section
  below. `holds` and `selectionExpiresAt`'s live countdown are deliberately kept _out_ of
  `partialize`/only partially persisted: holds are time-based shared state that would fight
  `BroadcastChannel` sync if `localStorage` were also treated as a source of truth for them.
- A real backend would still replace all of this with a server-held reservation (a TTL/hold expiry
  enforced by a server nothing stops a client from lying about) and use `localStorage` only as an
  optimistic local echo, not the source of truth.

## Live seat-hold contention: the performance guarantee, and its real limits

[`useHoldExpiry.ts`](../src/hooks/useHoldExpiry.ts) arms exactly one `setTimeout` for whichever
comes soonest - a tracked hold lapsing or this tab's own checkout deadline - rather than polling.
On fire, it calls `runExpiry()` in [`seatStore.ts`](../src/store/seatStore.ts), which prunes via
[`holdProtocol.ts`](../src/utils/holdProtocol.ts)'s `pruneHolds()`. That function returns the
**same** `Map` reference when nothing has actually lapsed, and the store skips its `set()` call
entirely in that case - so a routine tick with nothing to do costs zero re-renders across the
~1,500 mounted seats, not "one small one." This is asserted with a reference-equality (`toBe`) test
in `seatStore.test.ts`, specifically so a future refactor that starts always returning a new `Map`
fails a test instead of silently reintroducing a per-tick re-render.

**What this simulation is honest about not being:** [`holdChannel.ts`](../src/utils/holdChannel.ts)'s
`BroadcastChannel` transport only reaches other tabs of the _same browser on the same machine_ -
there is no server, so two different visitors on two different computers still can't contend for
the same seat here. The tie-break for a genuine same-instant conflict (lower session id wins,
in [`holdProtocol.ts`](../src/utils/holdProtocol.ts)'s `ingestPeerHold`) is a deterministic
convenience, not consensus - a real implementation would need a server to arbitrate. And the
"simulated" holds seeded onto venue.json's static `held` seats are exactly that: a demonstration
of the mechanism, not a claim about real inventory.

## Known remaining gaps

- No virtualization within an active section's own seat list (see above).
- The "Proceed to Pay" flow (see
  [`SeatSelectionFooter.tsx`](../src/components/SeatSelectionFooter.tsx)) is an intentional UI
  stub - it shows an inline confirmation, not a real payment integration. `confirmPurchase()` does
  re-validate the checkout deadline before completing, so at least the "the hold ran out mid-pay"
  failure mode is handled - see the "Live seat-hold contention" section above.
- ~~Seat availability (`sold`/`reserved`/`held`) is static sample data with no live update
  mechanism (no websocket/polling) - a second user selecting the same seat isn't reflected without
  a refresh.~~ **Partly resolved**: `held` seats now expire and release on a real timer, and a
  second seat-selecting _tab of the same browser_ is reflected live via `BroadcastChannel` (see
  above). The remaining, honest limitation: this is same-browser only. Two different visitors on
  two different machines still can't see each other's live selections - that needs a server
  pushing real inventory changes, which this project deliberately doesn't have.
- **Test coverage is well below the org engineering standard.** The standard
  ([`Webvoltz-Engineering-Standards/react`](../../Webvoltz-Engineering-Standards/react)) requires
  branches 85% / functions 100% / lines 90% / statements 90%. Actual project-wide coverage today
  (`pnpm test`, V8 provider, whole `src/` tree): **statements 54.1%, branches 56.2%, functions
  49.4%, lines 55.1%** - up substantially since the best-seats solver and live-hold work added
  ~15 new, near-100%-covered pure-logic modules under `src/utils/` and `src/hooks/`, but most
  _components_ still have no tests: `App.tsx`, `VenueMap.tsx`, `Section.tsx`, `BookingSummary.tsx`,
  `SeatSelectionFooter.tsx`, `BookingHistoryPanel.tsx`, `HoldRuntime.tsx`, `IconButton.tsx`,
  `Toast.tsx`, and `useVenue.ts` have none. The thresholds in [`vite.config.ts`](../vite.config.ts)
  are ratcheted up alongside real coverage gains (set just under today's actual numbers as a floor
  against regression), not set to the standard's targets - reaching those targets means writing
  real test suites for all of the above, which is a substantial task on its own, not a quick config
  change.
- ~~CI's pnpm version pin doesn't match the actual pnpm in use~~ **Resolved**: standardized on
  pnpm 11.x, matching this project's actual dev environment (the one pnpm version proven to work
  here all session). `.github/workflows/ci.yml`'s `PNPM_VERSION` is now `'11'`, and
  `package.json` pins `"packageManager": "pnpm@11.6.0"` to match - `pnpm install` confirmed clean
  locally with both in place (this is exactly the combination that previously failed when CI said
  `'10'` and `packageManager` said `pnpm@11.6.0`: pnpm tried to force-switch versions and aborted
  without an interactive terminal). Not independently verified against a real GitHub Actions run
  from here, but there's no reason pnpm 11 - a current, published major version - shouldn't install
  and run cleanly in that environment the same way it has here.
