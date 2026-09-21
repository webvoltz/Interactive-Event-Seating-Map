// Spreadsheet-style row lettering (A, B, ... Z, AA, AB, ...) so it never runs
// out for a section with more than 26 rows. Shared by the map (Seat.tsx) and
// the booking sidebar (BookingSummary.tsx) so a seat's row reads identically
// in both places instead of "Row 15" on one and "Row O" on the other.
export function rowLetter(rowIndex: number): string {
  let n = rowIndex + 1;
  let out = '';
  while (n > 0) {
    n -= 1;
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out;
}
