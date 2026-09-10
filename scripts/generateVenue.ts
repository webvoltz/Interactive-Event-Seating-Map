import fs from 'fs';

const MAP_WIDTH = 2400;
const MAP_HEIGHT = 2400;

const SECTIONS = 10;
const ROWS_PER_SECTION = 30;
const SEATS_PER_ROW = 50;

const CENTER_X = MAP_WIDTH / 2;
const CENTER_Y = MAP_HEIGHT / 2;

// Seeded PRNG (mulberry32) rather than Math.random(), so regenerating the
// venue produces the same demo data every time instead of a different
// scatter of sold/reserved/held seats on every run.
function mulberry32(seed: number) {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(20260908);

// Realistic-looking demo data: most seats available, with a believable mix
// of sold/reserved/held scattered in, so all four seat statuses are actually
// visible without hand-editing venue.json.
function pickStatus(): 'available' | 'sold' | 'reserved' | 'held' {
  const r = random();
  if (r < 0.7) return 'available';
  if (r < 0.85) return 'sold';
  if (r < 0.95) return 'reserved';
  return 'held';
}

let seatCounter = 1;

const sections = Array.from({ length: SECTIONS }, (_, sectionIndex) => {
  const startAngle = (2 * Math.PI * sectionIndex) / SECTIONS;
  const endAngle = (2 * Math.PI * (sectionIndex + 1)) / SECTIONS;

  return {
    id: `S-${sectionIndex + 1}`,
    label: `Section ${sectionIndex + 1}`,
    transform: { x: 0, y: 0, scale: 1 },
    rows: Array.from({ length: ROWS_PER_SECTION }, (_, rowIndex) => {
      const radius = 300 + rowIndex * 12;

      return {
        index: rowIndex + 1,
        seats: Array.from({ length: SEATS_PER_ROW }, (_, seatIndex) => {
          const angle = startAngle + ((endAngle - startAngle) * seatIndex) / SEATS_PER_ROW;

          // Rounding to whole pixels here would be fine at map scale, but
          // adjacent seats are only ~3-4 units apart (about one seat box
          // wide) - integer rounding turns the true smooth arc into a
          // visible zig-zag once zoomed in. Two decimals keeps the file
          // readable while staying well under any visible error.
          const x = Math.round((CENTER_X + Math.cos(angle) * radius) * 100) / 100;
          const y = Math.round((CENTER_Y + Math.sin(angle) * radius) * 100) / 100;

          return {
            id: `SEAT-${seatCounter++}`,
            col: seatIndex + 1,
            x,
            y,
            priceTier: rowIndex < 5 ? 1 : rowIndex < 15 ? 2 : 3,
            status: pickStatus(),
          };
        }),
      };
    }),
  };
});

const venue = {
  venueId: 'mega-arena',
  name: 'Grand Horizon Arena',
  map: { width: MAP_WIDTH, height: MAP_HEIGHT },
  sections,
};

fs.writeFileSync('public/venue.json', JSON.stringify(venue, null, 2));

console.log('seats generated');
