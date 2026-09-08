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
already-collapsed cover path. Within `Seats`, per-seat fill/stroke colors and the tier-color map are
recomputed on every render of that component - acceptable at ~1,500 seats, but the first thing to
hoist out (e.g., derive style from a lookup keyed by `status`/`priceTier` computed once) if a
section's seat count grows materially.

## `localStorage` persistence limits

[`seatStore.ts`](../src/store/seatStore.ts) persists `selectedSeats` to `localStorage` via a custom
`PersistStorage` that serializes the `Set<string>` to a plain array. This is enough for the current
scope (survive a page refresh, single device, no login) but has real limits:

- `localStorage` has a per-origin size ceiling (typically ~5–10MB depending on browser) - irrelevant
  at 8 selected seats, but the pattern shouldn't be reused to persist large datasets.
- No cross-device or cross-session sync - selections don't follow a user between browsers or
  devices, and there's no server-side hold/reservation, so two tabs (or two people) could both
  believe they've selected the same seat.
- A real backend would replace this with a server-held reservation (with a TTL/hold expiry) and use
  `localStorage` only as an optimistic local echo, not the source of truth.

## Known remaining gaps

- No virtualization within an active section's own seat list (see above).
- The "Proceed to Pay" flow (see [`BookingSummary.tsx`](../src/components/BookingSummary.tsx)) is an
  intentional UI stub - it shows an inline confirmation, not a real payment integration.
- Seat availability (`sold`/`reserved`/`held`) is static sample data with no live update mechanism
  (no websocket/polling) - a second user selecting the same seat isn't reflected without a refresh.
