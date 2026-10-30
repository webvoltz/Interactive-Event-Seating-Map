import type { EffectiveSeatStatus } from '../interfaces/venue.interfaces';
import { AVAILABLE, HELD, RESERVED, SOLD } from './seatBook';

export function simStatusToEffective(code: number): EffectiveSeatStatus {
  switch (code) {
    case HELD:
      return 'held';
    case SOLD:
      return 'sold';
    case RESERVED:
      return 'reserved';
    case AVAILABLE:
    default:
      return 'available';
  }
}
