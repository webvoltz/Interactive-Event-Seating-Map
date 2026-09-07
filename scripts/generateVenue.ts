import fs from 'fs';

const MAP_WIDTH = 2400;
const MAP_HEIGHT = 2400;

const SECTIONS = 10;
const ROWS_PER_SECTION = 30;
const SEATS_PER_ROW = 50;

const CENTER_X = MAP_WIDTH / 2;
const CENTER_Y = MAP_HEIGHT / 2;

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

          const x = Math.round(CENTER_X + Math.cos(angle) * radius);
          const y = Math.round(CENTER_Y + Math.sin(angle) * radius);

          return {
            id: `SEAT-${seatCounter++}`,
            col: seatIndex + 1,
            x,
            y,
            priceTier: rowIndex < 5 ? 1 : rowIndex < 15 ? 2 : 3,
            status: 'available',
          };
        }),
      };
    }),
  };
});

const venue = {
  venueId: 'mega-arena',
  name: 'Metropolis Mega Arena',
  map: { width: MAP_WIDTH, height: MAP_HEIGHT },
  sections,
};

fs.writeFileSync('public/venue.json', JSON.stringify(venue, null, 2));

console.log('seats generated');
