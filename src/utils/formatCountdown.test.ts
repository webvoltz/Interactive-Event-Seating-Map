import { describe, expect, it } from 'vitest';
import {
  describeCountdownMilestone,
  formatCountdown,
  pickCountdownMilestone,
} from './formatCountdown';

describe('formatCountdown', () => {
  it.each([
    [300_000, '5:00'],
    [65_000, '1:05'],
    [5_000, '0:05'],
    [999, '0:01'], // ceil, not floor
    [0, '0:00'],
    [-5_000, '0:00'],
    [3_600_000, '60:00'],
  ])('formatCountdown(%i) -> %s', (ms, expected) => {
    expect(formatCountdown(ms)).toBe(expected);
  });
});

describe('pickCountdownMilestone', () => {
  it.each([
    [301_000, 'start'],
    [300_000, 'start'],
    [121_000, 'start'],
    [120_000, '2min'],
    [61_000, '2min'],
    [60_000, '1min'],
    [31_000, '1min'],
    [30_000, '30s'],
    [11_000, '30s'],
    [10_000, '10s'],
    [1_000, '10s'],
    [0, 'expired'],
  ])('pickCountdownMilestone(%i) -> %s', (ms, expected) => {
    expect(pickCountdownMilestone(ms)).toBe(expected);
  });

  it('is stable across an entire band - the property that keeps aria-live quiet', () => {
    expect(pickCountdownMilestone(119_000)).toBe(pickCountdownMilestone(61_000));
  });

  it('changes when crossing the 2-minute boundary', () => {
    expect(pickCountdownMilestone(121_000)).not.toBe(pickCountdownMilestone(119_000));
  });
});

describe('describeCountdownMilestone', () => {
  it('has distinct, non-empty copy for every milestone', () => {
    const milestones = ['start', '2min', '1min', '30s', '10s', 'expired'] as const;
    const descriptions = milestones.map(describeCountdownMilestone);
    expect(new Set(descriptions).size).toBe(milestones.length);
    descriptions.forEach((d) => {
      expect(d.length).toBeGreaterThan(0);
    });
  });
});
