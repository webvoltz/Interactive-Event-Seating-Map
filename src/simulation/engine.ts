import type { Venue } from '../interfaces/venue.interfaces';
import { findBestSeats } from '../utils/findBestSeats';
import { peerWinsClash } from '../utils/holdProtocol';
import { TIERS } from '../utils/seatIndex';
import { MAX_GROUP_SIZE, type SimConfig } from './config';
import { EventQueue } from './eventQueue';
import { createRng, mix32, type Rng } from './random';
import { AVAILABLE, HELD, NO_OWNER, SOLD, SeatBook } from './seatBook';

// The simulated clock only ever moves in whole ticks, so speed never changes the outcome.
export const TICK_MS = 100;

export const STAGE = {
  ARRIVING: 0,
  QUEUED: 1,
  ADMITTED: 2,
  SEARCHING: 3,
  HOLDING: 4,
  PURCHASED: 5,
  ABANDONED: 6,
} as const;

const EV_SEARCH = 0;
const EV_PAY = 1;
const EV_EXPIRE = 2;
const EV_QUEUE_TIMEOUT = 3;

const GROUP_WEIGHTS = [20, 35, 15, 18, 4, 4, 2, 2];
const BUDGET_CAPS = Object.values(TIERS)
  .map((t) => t.price)
  .sort((a, b) => a - b);
const BUDGET_WEIGHTS = [25, 35, 40];
const PAYER_SHARE = 0.92;
// Buyers also skip a slice of seats at random (a view they dislike, a row they'd rather not be in),
// so the whole crowd doesn't fight over the identical best block.
const TASTE_SKIP_BYTE = 36;
// Losing a race this many times in a row is where a real buyer stops refreshing and leaves.
const MAX_CLASH_RETRIES = 6;
const HEAT_WINDOW_TICKS = 100;
const CLASH_WINDOW_TICKS = 10;
const SESSION_ID_WIDTH = 6;
const QUEUE_RECHECK_MS = 60_000;

export interface SectionStats {
  total: number;
  sold: number;
  held: number;
  reserved: number;
  available: number;
  // First moment nothing in the section was left to buy, or null if that never happened.
  soldOutAtMs: number | null;
  soldOut: boolean;
  // Seats claimed (held or sold) in the trailing 10 simulated seconds.
  velocity: number;
}

export interface SimStats {
  simTimeMs: number;
  totalBuyers: number;
  finished: boolean;
  stages: Record<
    'arriving' | 'queued' | 'searching' | 'holding' | 'purchased' | 'abandoned',
    number
  >;
  queueLength: number;
  served: number;
  turnedAway: number;
  gaveUp: number;
  gaveUpInQueue: number;
  gaveUpSearching: number;
  holdsLapsed: number;
  activeHolds: number;
  expiredHolds: number;
  clashes: number;
  clashesPerSec: number;
  avgWaitMs: number;
  revenue: number;
  seats: { total: number; available: number; held: number; sold: number; reserved: number };
  soldPct: number;
  soldOutAtMs: number | null;
  saleOverAtMs: number | null;
  sections: SectionStats[];
}

// One point of the sale's history, taken on a fixed simulated schedule so charts repeat exactly.
export interface SimSample {
  t: number;
  revenue: number;
  soldSeats: number;
  heldSeats: number;
  queue: number;
  activeHolds: number;
  // Contested seats since the previous sample.
  clashes: number;
  // Everything the stats panel shows, as of this moment, so a replay can show it again.
  snapshot: SimStats;
}

export const SAMPLE_MS = 5_000;

export type ViewerStage = 'none' | 'queued' | 'admitted' | 'turned-away' | 'left';

export interface ViewerState {
  stage: ViewerStage;
  // 1-based place in the waiting room while queued.
  position: number | null;
  // Simulated time until admission at the current rate; null when admission is paused (all seats held).
  etaMs: number | null;
  // Seat indices the viewer currently holds.
  seats: number[];
  seatsBought: number;
}

export interface ViewerHoldResult {
  held: number[];
  rejected: number[];
}

export interface SimDelta {
  samples: SimSample[];
  // The simulated tick (TICK_MS each) at which each entry of `seatChanges` happened.
  changeTicks: Uint32Array;
  // Packed (seatIndex << 2) | status, in the order the changes happened.
  seatChanges: Uint32Array;
  soldOutSections: number[];
}

interface Claim {
  buyer: number;
  seats: number[];
}

export function sessionIdOf(buyer: number): string {
  return `buyer-${String(buyer).padStart(SESSION_ID_WIDTH, '0')}`;
}

export class SimulationEngine {
  readonly book: SeatBook;
  private readonly venue: Venue;
  private readonly config: SimConfig;
  private readonly rng: Rng;
  private readonly events = new EventQueue();

  private now = 0;
  private tickNo = 0;

  // Per-buyer state, struct-of-arrays so 20k buyers stay cheap.
  private readonly arriveAt: Float64Array;
  private readonly groupSize: Uint8Array;
  private readonly budgetIndex: Uint8Array;
  private readonly prefSection: Uint16Array;
  private readonly wantsView: Uint8Array;
  private readonly patience: Uint8Array;
  private readonly queuePatienceMs: Uint32Array;
  private readonly salt: Uint32Array;
  private readonly stage: Uint8Array;
  private readonly attempts: Uint8Array;
  private readonly tries: Uint16Array;
  private readonly clashCount: Uint8Array;
  private readonly need: Uint8Array;
  private readonly heldCount: Uint8Array;
  private readonly heldSeats: Int32Array;
  private readonly queuedAt: Float64Array;
  private readonly holdExpiresAt: Float64Array;

  // The viewer is one more buyer, past the crowd, driven by commands instead of the state machine.
  private readonly viewerIndex: number;
  private viewerStage: ViewerStage = 'none';
  private viewerSeats: number[] = [];
  private viewerBought = 0;
  private viewerQueueSlot = -1;

  private nextArrival = 0;
  private readonly queue: Int32Array;
  private queueHead = 0;
  private queueTail = 0;
  private queueLive = 0;
  private admitTokens = 0;
  // Admitted buyers who haven't made their first search yet; they will each want seats.
  private pendingSearch = 0;

  private changes: number[] = [];
  private changeTicks: number[] = [];
  private soldOutNow: number[] = [];
  private readonly sectionFlaggedSoldOut: Uint8Array;
  private readonly sectionSoldOutAt: Float64Array;
  private samples: SimSample[] = [];
  private clashesAtLastSample = 0;
  private finalSampleTaken = false;

  private readonly claimedBy: Int32Array;
  private readonly heatRing: Uint16Array;
  private readonly heatSum: Uint32Array;
  private readonly clashRing = new Uint32Array(CLASH_WINDOW_TICKS);

  private served = 0;
  private turnedAway = 0;
  private gaveUpInQueue = 0;
  private gaveUpSearching = 0;
  private holdsLapsed = 0;
  private clashes = 0;
  private waitTotalMs = 0;
  private revenue = 0;
  private soldOutAtMs: number | null = null;
  private saleOverAtMs: number | null = null;

  constructor(venue: Venue, config: SimConfig) {
    this.venue = venue;
    this.config = config;
    this.rng = createRng(config.seed);
    this.viewerIndex = config.buyers;
    this.book = new SeatBook(venue);

    // One extra slot, past the crowd, belongs to the viewer who may join as a buyer.
    const n = config.buyers + 1;
    this.arriveAt = new Float64Array(n);
    this.groupSize = new Uint8Array(n);
    this.budgetIndex = new Uint8Array(n);
    this.prefSection = new Uint16Array(n);
    this.wantsView = new Uint8Array(n);
    this.patience = new Uint8Array(n);
    this.queuePatienceMs = new Uint32Array(n);
    this.salt = new Uint32Array(n);
    this.stage = new Uint8Array(n);
    this.attempts = new Uint8Array(n);
    this.tries = new Uint16Array(n);
    this.clashCount = new Uint8Array(n);
    this.need = new Uint8Array(n);
    this.heldCount = new Uint8Array(n);
    this.heldSeats = new Int32Array(n * MAX_GROUP_SIZE);
    this.queuedAt = new Float64Array(n);
    this.holdExpiresAt = new Float64Array(n);
    this.queue = new Int32Array(n);

    this.sectionFlaggedSoldOut = new Uint8Array(this.book.sectionCount);
    this.sectionSoldOutAt = new Float64Array(this.book.sectionCount).fill(Number.NaN);
    this.claimedBy = new Int32Array(this.book.seatCount).fill(NO_OWNER);
    this.heatRing = new Uint16Array(HEAT_WINDOW_TICKS * this.book.sectionCount);
    this.heatSum = new Uint32Array(this.book.sectionCount);

    this.generateBuyers();
    if (this.book.availableCount === 0) this.saleOverAtMs = 0;
    this.recordSample();
  }

  get simTimeMs(): number {
    return this.now;
  }

  get finished(): boolean {
    return this.nextArrival >= this.config.buyers && this.queueLive === 0 && this.events.size === 0;
  }

  // Advances in whole ticks only; returns the simulated time actually reached.
  advanceTo(targetMs: number): number {
    while (this.now + TICK_MS <= targetMs && !this.finished) this.tick();
    return this.now;
  }

  drainDelta(): SimDelta {
    const delta: SimDelta = {
      samples: this.samples,
      seatChanges: Uint32Array.from(this.changes),
      changeTicks: Uint32Array.from(this.changeTicks),
      soldOutSections: this.soldOutNow,
    };
    this.changes = [];
    this.changeTicks = [];
    this.soldOutNow = [];
    this.samples = [];
    return delta;
  }

  statusSnapshot(): Uint8Array {
    return this.book.status.slice();
  }

  getStats(): SimStats {
    const stageCount = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < this.config.buyers; i++) {
      const s = this.stage[i] ?? 0;
      stageCount[s] = (stageCount[s] ?? 0) + 1;
    }
    const sections: SectionStats[] = [];
    for (let s = 0; s < this.book.sectionCount; s++) {
      const available = this.book.sectionAvailable[s] ?? 0;
      const total = this.book.sectionSeatTotal[s] ?? 0;
      const sold = this.book.sectionSold[s] ?? 0;
      const reserved = this.book.sectionReserved[s] ?? 0;
      const soldOutAt = this.sectionSoldOutAt[s] ?? Number.NaN;
      sections.push({
        total,
        sold,
        held: total - sold - reserved - available,
        reserved,
        available,
        soldOutAtMs: Number.isNaN(soldOutAt) ? null : soldOutAt,
        soldOut: available === 0,
        velocity: this.heatSum[s] ?? 0,
      });
    }
    let clashWindow = 0;
    for (const c of this.clashRing) clashWindow += c;
    const { book } = this;
    const reserved = book.seatCount - book.availableCount - book.heldCount - book.soldCount;
    const sellable = book.seatCount - reserved;
    return {
      simTimeMs: this.now,
      totalBuyers: this.config.buyers,
      finished: this.finished,
      stages: {
        arriving: stageCount[STAGE.ARRIVING] ?? 0,
        queued: stageCount[STAGE.QUEUED] ?? 0,
        searching: (stageCount[STAGE.ADMITTED] ?? 0) + (stageCount[STAGE.SEARCHING] ?? 0),
        holding: stageCount[STAGE.HOLDING] ?? 0,
        purchased: stageCount[STAGE.PURCHASED] ?? 0,
        abandoned: stageCount[STAGE.ABANDONED] ?? 0,
      },
      queueLength: this.queueLive,
      served: this.served,
      turnedAway: this.turnedAway,
      gaveUp: this.gaveUpInQueue + this.gaveUpSearching + this.holdsLapsed,
      gaveUpInQueue: this.gaveUpInQueue,
      gaveUpSearching: this.gaveUpSearching,
      holdsLapsed: this.holdsLapsed,
      activeHolds: stageCount[STAGE.HOLDING] ?? 0,
      expiredHolds: this.holdsLapsed,
      clashes: this.clashes,
      clashesPerSec: clashWindow / ((CLASH_WINDOW_TICKS * TICK_MS) / 1000),
      avgWaitMs: this.served === 0 ? 0 : this.waitTotalMs / this.served,
      revenue: this.revenue,
      seats: {
        total: book.seatCount,
        available: book.availableCount,
        held: book.heldCount,
        sold: book.soldCount,
        reserved,
      },
      soldPct: sellable === 0 ? 0 : (book.soldCount / sellable) * 100,
      soldOutAtMs: this.soldOutAtMs,
      saleOverAtMs: this.saleOverAtMs,
      sections,
    };
  }

  // ---- setup -------------------------------------------------------------------------------

  private generateBuyers(): void {
    const { rng, config } = this;
    const n = config.buyers;
    const arrivals = new Float64Array(n);
    for (let i = 0; i < n; i++) arrivals[i] = Math.round(this.drawArrival());
    arrivals.sort();
    this.arriveAt.set(arrivals);

    for (let i = 0; i < n; i++) {
      this.groupSize[i] = rng.weighted(GROUP_WEIGHTS) + 1;
      this.need[i] = this.groupSize[i] ?? 1;
      this.budgetIndex[i] = rng.weighted(BUDGET_WEIGHTS);
      this.prefSection[i] = rng.int(this.book.sectionCount);
      this.wantsView[i] = rng.next() < 0.55 ? 1 : 0;
      this.patience[i] = rng.between(4, 8);
      this.queuePatienceMs[i] = rng.between(60_000, 900_000);
      this.salt[i] = Math.floor(rng.next() * 4294967296);
      this.stage[i] = STAGE.ARRIVING;
    }
  }

  private drawArrival(): number {
    const { rng } = this;
    const exponential = (meanMs: number) => -Math.log(1 - rng.next()) * meanMs;
    switch (this.config.pattern) {
      case 'spike':
        return Math.min(exponential(3_000), 20_000);
      case 'steady':
        return rng.next() * 120_000;
      case 'waves':
        return rng.int(3) * 40_000 + Math.min(exponential(5_000), 25_000);
    }
  }

  // ---- tick loop ---------------------------------------------------------------------------

  private tick(): void {
    this.tickNo += 1;
    this.now += TICK_MS;
    const slot = this.tickNo % HEAT_WINDOW_TICKS;
    this.expireHeatSlot(slot);
    this.clashRing[this.tickNo % CLASH_WINDOW_TICKS] = 0;

    this.admitArrivals();
    this.admitFromQueue();

    const searchers: number[] = [];
    for (let t = this.events.peekTime(); t !== null && t <= this.now; t = this.events.peekTime()) {
      const event = this.events.pop();
      if (!event) break;
      if (event.kind === EV_SEARCH) searchers.push(event.buyer);
      else this.handleTimedEvent(event.kind, event.buyer, event.time);
    }

    this.runSearches(searchers);
    this.checkSaleOver();
    this.sampleIfDue();
  }

  private sampleIfDue(): void {
    if (this.now % SAMPLE_MS === 0) {
      this.recordSample();
    } else if (this.finished && !this.finalSampleTaken) {
      this.recordSample();
    }
    if (this.finished) this.finalSampleTaken = true;
  }

  private recordSample(): void {
    let activeHolds = 0;
    for (let i = 0; i < this.config.buyers; i++) {
      if (this.stage[i] === STAGE.HOLDING) activeHolds += 1;
    }
    this.samples.push({
      t: this.now,
      revenue: this.revenue,
      soldSeats: this.book.soldCount,
      heldSeats: this.book.heldCount,
      queue: this.queueLive,
      activeHolds,
      clashes: this.clashes - this.clashesAtLastSample,
      snapshot: this.getStats(),
    });
    this.clashesAtLastSample = this.clashes;
  }

  private expireHeatSlot(slot: number): void {
    const sections = this.book.sectionCount;
    for (let s = 0; s < sections; s++) {
      const idx = slot * sections + s;
      this.heatSum[s] = (this.heatSum[s] ?? 0) - (this.heatRing[idx] ?? 0);
      this.heatRing[idx] = 0;
    }
  }

  private admitArrivals(): void {
    while (this.nextArrival < this.config.buyers) {
      const buyer = this.nextArrival;
      if ((this.arriveAt[buyer] ?? 0) > this.now) break;
      this.nextArrival += 1;
      if (this.saleOverAtMs !== null) {
        this.turnAway(buyer);
        continue;
      }
      this.stage[buyer] = STAGE.QUEUED;
      this.queuedAt[buyer] = this.arriveAt[buyer] ?? this.now;
      this.queue[this.queueTail] = buyer;
      this.queueTail += 1;
      this.queueLive += 1;
      this.events.push(
        (this.queuedAt[buyer] ?? 0) + (this.queuePatienceMs[buyer] ?? 0),
        buyer,
        EV_QUEUE_TIMEOUT,
      );
    }
  }

  private admitFromQueue(): void {
    // Admission pauses while every seat is spoken for but some may yet be released.
    if (this.book.availableCount === 0) {
      this.admitTokens = 0;
      return;
    }
    this.admitTokens = Math.min(
      this.admitTokens + (this.config.admitPerSec * TICK_MS) / 1000,
      this.config.admitPerSec,
    );
    // Never let in more people than there are seats for: a real waiting room admits against stock,
    // otherwise a handful of freed seats would turn thousands of buyers away.
    while (
      this.admitTokens >= 1 &&
      this.queueHead < this.queueTail &&
      this.pendingSearch < this.book.availableCount
    ) {
      const buyer = this.queue[this.queueHead] ?? 0;
      this.queueHead += 1;
      if (this.stage[buyer] !== STAGE.QUEUED) continue;
      this.admitTokens -= 1;
      this.queueLive -= 1;
      this.stage[buyer] = STAGE.ADMITTED;
      if (buyer === this.viewerIndex) {
        this.viewerStage = 'admitted';
        continue;
      }
      this.pendingSearch += 1;
      this.served += 1;
      this.waitTotalMs += this.now - (this.queuedAt[buyer] ?? this.now);
      this.events.push(this.now + this.rng.between(400, 2_500), buyer, EV_SEARCH);
    }
  }

  private handleTimedEvent(kind: number, buyer: number, time: number): void {
    switch (kind) {
      case EV_QUEUE_TIMEOUT:
        if (this.stage[buyer] !== STAGE.QUEUED) break;
        if (this.book.availableCount === 0) {
          // Everything is held, so the waiting room is paused rather than slow: people stay on the
          // sold-out page hoping a hold lapses, and check back again after a while.
          this.events.push(time + QUEUE_RECHECK_MS, buyer, EV_QUEUE_TIMEOUT);
        } else {
          this.stage[buyer] = STAGE.ABANDONED;
          this.queueLive -= 1;
          this.gaveUpInQueue += 1;
        }
        break;
      case EV_PAY:
        if (this.stage[buyer] === STAGE.HOLDING && (this.holdExpiresAt[buyer] ?? 0) > time) {
          this.completePurchase(buyer);
        }
        break;
      case EV_EXPIRE:
        // Mirrors pruneHolds: a hold is live only while expiresAt > now.
        if (this.hasLiveHoldState(buyer) && (this.holdExpiresAt[buyer] ?? 0) <= time) {
          this.releaseAll(buyer);
          this.stage[buyer] = STAGE.ABANDONED;
          this.holdsLapsed += 1;
        }
        break;
    }
  }

  private hasLiveHoldState(buyer: number): boolean {
    const stage = this.stage[buyer];
    return (
      (stage === STAGE.HOLDING || stage === STAGE.SEARCHING) && (this.heldCount[buyer] ?? 0) > 0
    );
  }

  private completePurchase(buyer: number): void {
    const count = this.heldCount[buyer] ?? 0;
    for (let k = 0; k < count; k++) {
      const seat = this.heldSeats[buyer * MAX_GROUP_SIZE + k] ?? 0;
      this.book.sell(seat);
      this.revenue += this.book.price[seat] ?? 0;
      this.record(seat, SOLD);
    }
    this.heldCount[buyer] = 0;
    this.stage[buyer] = STAGE.PURCHASED;
  }

  private releaseAll(buyer: number): void {
    const count = this.heldCount[buyer] ?? 0;
    for (let k = 0; k < count; k++) {
      const seat = this.heldSeats[buyer * MAX_GROUP_SIZE + k] ?? 0;
      this.book.release(seat);
      this.record(seat, AVAILABLE);
      const section = this.book.sectionOf[seat] ?? 0;
      this.sectionFlaggedSoldOut[section] = 0;
    }
    this.heldCount[buyer] = 0;
  }

  private turnAway(buyer: number): void {
    this.stage[buyer] = STAGE.ABANDONED;
    this.turnedAway += 1;
  }

  // ---- searching ---------------------------------------------------------------------------

  private runSearches(searchers: number[]): void {
    if (searchers.length === 0) return;
    searchers.sort((a, b) => a - b);

    // Every search in a tick reads the same start-of-tick snapshot, then claims are reconciled,
    // so two buyers can genuinely want the same seat at once.
    const claims: Claim[] = [];
    const failed: number[] = [];
    for (const buyer of searchers) {
      const stage = this.stage[buyer];
      if (stage !== STAGE.ADMITTED && stage !== STAGE.SEARCHING) continue;
      if (stage === STAGE.ADMITTED) this.pendingSearch -= 1;
      this.stage[buyer] = STAGE.SEARCHING;
      const seats = this.findSeatsFor(buyer);
      if (seats) claims.push({ buyer, seats });
      else failed.push(buyer);
    }

    const touched: number[] = [];
    for (const claim of claims) this.resolveClaim(claim, touched);
    for (const seat of touched) this.claimedBy[seat] = NO_OWNER;

    for (const buyer of failed) this.onSearchFailed(buyer);
  }

  private resolveClaim(claim: Claim, touched: number[]): void {
    const { buyer, seats } = claim;
    let contested = 0;
    for (const seat of seats) {
      const rival = this.claimedBy[seat] ?? NO_OWNER;
      if (rival !== NO_OWNER && peerWinsClash(sessionIdOf(rival), sessionIdOf(buyer))) {
        contested += 1;
      }
    }

    if (contested > 0) {
      this.clashes += contested;
      const ring = this.tickNo % CLASH_WINDOW_TICKS;
      this.clashRing[ring] = (this.clashRing[ring] ?? 0) + contested;
      this.clashCount[buyer] = (this.clashCount[buyer] ?? 0) + 1;
      if ((this.clashCount[buyer] ?? 0) > MAX_CLASH_RETRIES) {
        this.giveUpSearching(buyer);
      } else {
        // Backs off a little longer after each lost race.
        const backoff = this.rng.between(200, 900) * (this.clashCount[buyer] ?? 1);
        this.events.push(this.now + backoff, buyer, EV_SEARCH);
      }
      return;
    }

    const firstSeatsOfCart = (this.heldCount[buyer] ?? 0) === 0;
    for (const seat of seats) {
      this.claimedBy[seat] = buyer;
      touched.push(seat);
      this.book.hold(seat, buyer);
      this.afterSeatHeld(seat);
      this.heldSeats[buyer * MAX_GROUP_SIZE + (this.heldCount[buyer] ?? 0)] = seat;
      this.heldCount[buyer] = (this.heldCount[buyer] ?? 0) + 1;
    }

    if (firstSeatsOfCart) {
      // The clock starts with the first seats; adding more later doesn't extend it.
      this.holdExpiresAt[buyer] = this.now + this.config.holdMs;
      this.events.push(this.holdExpiresAt[buyer] ?? 0, buyer, EV_EXPIRE);
    }
    this.need[buyer] = (this.need[buyer] ?? 0) - seats.length;

    if ((this.need[buyer] ?? 0) > 0) {
      this.events.push(this.now + this.rng.between(400, 2_000), buyer, EV_SEARCH);
      return;
    }

    this.stage[buyer] = STAGE.HOLDING;
    if (this.rng.next() < PAYER_SHARE) {
      const remaining = (this.holdExpiresAt[buyer] ?? this.now) - this.now;
      this.events.push(this.now + remaining * (0.05 + 0.4 * this.rng.next()), buyer, EV_PAY);
    }
  }

  // Bookkeeping every newly held seat needs, whoever holds it.
  private afterSeatHeld(seat: number): void {
    this.record(seat, HELD);
    const section = this.book.sectionOf[seat] ?? 0;
    const heatIdx = (this.tickNo % HEAT_WINDOW_TICKS) * this.book.sectionCount + section;
    this.heatRing[heatIdx] = (this.heatRing[heatIdx] ?? 0) + 1;
    this.heatSum[section] = (this.heatSum[section] ?? 0) + 1;
    if ((this.book.sectionAvailable[section] ?? 0) === 0 && !this.sectionFlaggedSoldOut[section]) {
      this.sectionFlaggedSoldOut[section] = 1;
      if (Number.isNaN(this.sectionSoldOutAt[section])) this.sectionSoldOutAt[section] = this.now;
      this.soldOutNow.push(section);
    }
    if (this.book.availableCount === 0 && this.soldOutAtMs === null) this.soldOutAtMs = this.now;
  }

  private record(seat: number, status: number): void {
    this.changes.push((seat << 2) | status);
    this.changeTicks.push(this.tickNo);
  }

  private onSearchFailed(buyer: number): void {
    this.attempts[buyer] = (this.attempts[buyer] ?? 0) + 1;
    if (this.book.availableCount === 0) {
      this.releaseAll(buyer);
      this.turnAway(buyer);
    } else if ((this.attempts[buyer] ?? 0) >= (this.patience[buyer] ?? 0)) {
      this.giveUpSearching(buyer);
    } else {
      this.events.push(this.now + this.rng.between(400, 2_500), buyer, EV_SEARCH);
    }
  }

  private giveUpSearching(buyer: number): void {
    this.releaseAll(buyer);
    this.stage[buyer] = STAGE.ABANDONED;
    this.gaveUpSearching += 1;
  }

  // Escalating fallback: preferred section -> any section -> higher budget -> split the group.
  private findSeatsFor(buyer: number): number[] | null {
    const attempt = this.attempts[buyer] ?? 0;
    const need = this.need[buyer] ?? 1;

    let size = need;
    if (attempt === 3 && need > 1) size = Math.ceil(need / 2);
    if (attempt >= 4) size = 1;

    const budgetStep = Math.min(
      BUDGET_CAPS.length - 1,
      (this.budgetIndex[buyer] ?? 0) + (attempt >= 2 ? 1 : 0),
    );
    const budget = attempt >= 4 ? Infinity : (BUDGET_CAPS[budgetStep] ?? Infinity);

    const sections: Venue['sections'] = [];
    if (attempt === 0) {
      const preferred = this.prefSection[buyer] ?? 0;
      const section = this.venue.sections[preferred];
      if (section && this.book.longestFreeRun(preferred, budget) >= size) sections.push(section);
    } else {
      this.venue.sections.forEach((section, s) => {
        if (this.book.longestFreeRun(s, budget) >= size) sections.push(section);
      });
    }
    if (sections.length === 0) return null;

    const tasteOn = attempt < 2;
    const salt = mix32(this.salt[buyer] ?? 0, this.tries[buyer] ?? 0);
    this.tries[buyer] = (this.tries[buyer] ?? 0) + 1;
    const { book } = this;

    const block = findBestSeats(
      { ...this.venue, sections },
      size,
      this.wantsView[buyer] ? 'view' : 'price',
      (seat) => {
        const index = book.indexById.get(seat.id);
        if (index === undefined || book.status[index] !== AVAILABLE) return false;
        if ((book.price[index] ?? 0) > budget) return false;
        return !tasteOn || (mix32(salt, index) & 0xff) >= TASTE_SKIP_BYTE;
      },
    );
    if (!block) return null;

    const indices: number[] = [];
    for (const id of block.seatIds) {
      const index = book.indexById.get(id);
      if (index !== undefined) indices.push(index);
    }
    return indices;
  }

  private checkSaleOver(): void {
    if (this.saleOverAtMs !== null) return;
    if (this.book.availableCount !== 0 || this.book.heldCount !== 0) return;
    this.saleOverAtMs = this.now;
    while (this.queueHead < this.queueTail) {
      const buyer = this.queue[this.queueHead] ?? 0;
      this.queueHead += 1;
      if (this.stage[buyer] !== STAGE.QUEUED) continue;
      this.queueLive -= 1;
      if (buyer === this.viewerIndex) {
        this.stage[buyer] = STAGE.ABANDONED;
        this.viewerStage = 'turned-away';
      } else {
        this.turnAway(buyer);
      }
    }
  }

  // ---- the viewer as a buyer ----------------------------------------------------------------

  // Joins the back of the waiting room. Ignored if already in, or told the sale is over.
  joinViewer(): void {
    if (this.viewerStage === 'queued' || this.viewerStage === 'admitted') return;
    if (this.saleOverAtMs !== null) {
      this.viewerStage = 'turned-away';
      return;
    }
    const viewer = this.viewerIndex;
    this.viewerStage = 'queued';
    this.stage[viewer] = STAGE.QUEUED;
    this.queuedAt[viewer] = this.now;
    this.viewerQueueSlot = this.queueTail;
    this.queue[this.queueTail] = viewer;
    this.queueTail += 1;
    this.queueLive += 1;
  }

  // Only an admitted viewer can hold seats. Seats someone else already has come back as rejected.
  holdViewerSeats(seats: readonly number[]): ViewerHoldResult {
    const result: ViewerHoldResult = { held: [], rejected: [] };
    for (const seat of seats) {
      const room = this.viewerSeats.length < MAX_GROUP_SIZE;
      if (this.viewerStage === 'admitted' && room && this.book.hold(seat, this.viewerIndex)) {
        this.viewerSeats.push(seat);
        this.afterSeatHeld(seat);
        result.held.push(seat);
      } else {
        result.rejected.push(seat);
      }
    }
    return result;
  }

  releaseViewerSeats(seats: readonly number[]): void {
    for (const seat of seats) {
      const at = this.viewerSeats.indexOf(seat);
      if (at < 0) continue;
      this.viewerSeats.splice(at, 1);
      this.book.release(seat);
      this.record(seat, AVAILABLE);
      this.sectionFlaggedSoldOut[this.book.sectionOf[seat] ?? 0] = 0;
    }
  }

  buyViewerSeats(seats: readonly number[]): void {
    for (const seat of seats) {
      const at = this.viewerSeats.indexOf(seat);
      if (at < 0) continue;
      this.viewerSeats.splice(at, 1);
      this.book.sell(seat);
      this.revenue += this.book.price[seat] ?? 0;
      this.record(seat, SOLD);
      this.viewerBought += 1;
    }
  }

  leaveViewer(): void {
    this.releaseViewerSeats([...this.viewerSeats]);
    if (this.stage[this.viewerIndex] === STAGE.QUEUED) {
      this.stage[this.viewerIndex] = STAGE.ABANDONED;
      this.queueLive -= 1;
    }
    this.viewerStage = 'left';
  }

  getViewerState(): ViewerState {
    let position: number | null = null;
    let etaMs: number | null = null;
    if (this.viewerStage === 'queued') {
      position = 0;
      for (let i = this.queueHead; i <= this.viewerQueueSlot; i++) {
        if (this.stage[this.queue[i] ?? 0] === STAGE.QUEUED) position += 1;
      }
      if (this.book.availableCount > 0) etaMs = (position / this.config.admitPerSec) * 1000;
    }
    return {
      stage: this.viewerStage,
      position,
      etaMs,
      seats: [...this.viewerSeats],
      seatsBought: this.viewerBought,
    };
  }
}
