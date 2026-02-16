/**
 * SM-2 Spaced Repetition Algorithm (Modified)
 *
 * Quality ratings:
 * 0 = Again (complete blackout) - immediately due
 * 1 = Hard (incorrect, but upon seeing answer it was easy to recall) - show again in 1 minute
 * 2 = Good (correct with some difficulty) - standard progression
 * 3 = Easy (correct with no hesitation) - standard progression with bonus
 */

export interface CardStats {
  dueAt: number;
  interval: number; // in days (0 = learning phase)
  easeFactor: number;
}

export interface Card {
  dueAt?: number;
  interval?: number;
  easeFactor?: number;
}

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

export function calculateNextReview(quality: number, card: Card): CardStats {
  let easeFactor = card.easeFactor ?? 2.5;
  let interval = card.interval ?? 0;
  let dueAt: number;

  // Update ease factor (minimum 1.3)
  easeFactor = Math.max(
    1.3,
    easeFactor + (0.1 - (3 - quality) * (0.08 + (3 - quality) * 0.02))
  );

  if (quality === 0) {
    // Again - immediately due but at back of queue, reset to learning phase
    interval = 0;
    dueAt = Date.now();
  } else if (quality === 1) {
    // Hard - show in 1 minute, stay in learning phase
    interval = 0;
    dueAt = Date.now() + 1 * MINUTE;
  } else {
    // Good or Easy - standard SM-2 progression
    if (interval === 0) {
      interval = 1;
    } else if (interval === 1) {
      interval = 6;
    } else {
      interval = Math.round(interval * easeFactor);
    }

    // Bonus for Easy
    if (quality === 3) {
      interval = Math.round(interval * 1.3);
    }

    dueAt = Date.now() + interval * DAY;
  }

  return { dueAt, interval, easeFactor };
}
