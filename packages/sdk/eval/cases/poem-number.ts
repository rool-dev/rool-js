import { expect } from 'chai';
import type { TestCase } from '../types.js';
import { expectLinkCount } from '../helpers.js';

const DIGIT_TO_WORDS: Record<string, string[]> = {
  '0': ['zero', 'none', 'nothing', 'naught'],
  '1': ['one', 'single', 'first', 'alone', 'unity'],
  '2': ['two', 'pair', 'couple', 'second', 'twice', 'double'],
  '3': ['three', 'third', 'triple', 'trio'],
  '4': ['four', 'fourth', 'quarter'],
  '5': ['five', 'fifth'],
  '6': ['six', 'sixth'],
  '7': ['seven', 'seventh', 'lucky'],
  '8': ['eight', 'eighth'],
  '9': ['nine', 'ninth'],
};

/**
 * Tests multi-field coherence.
 * Validates that headline (digit) and text (poem) are semantically related.
 */
export const testCase: TestCase = {
  description: 'Creates a poem about a random number with coherent headline',

  async run(space) {
    const { objects } = await space.prompt(`
      Create a markdown object with:
      - headline: a single digit (0-9) representing a randomly chosen number
      - text: a short poem (at least 4 lines) about that number

      The headline must be exactly one character: the digit itself, not the word.
      The poem must be about that specific number and must include the number itself.
    `);

    // Should create exactly 1 object
    expect(objects).to.have.length(1);

    const poem = objects[0];

    // Headline should be a single digit
    expect(poem.headline).to.match(/^[0-9]$/, 'Headline should be a single digit');

    // Text should be multi-line (at least 4 lines)
    const text = poem.text as string;
    expect(text).to.be.a('string');
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    expect(lines.length).to.be.at.least(4, 'Poem should have at least 4 lines');

    // Poem should reference the number
    const digit = poem.headline as string;
    const lowerText = text.toLowerCase();
    const words = DIGIT_TO_WORDS[digit] || [];
    const mentionsNumber = lowerText.includes(digit) || words.some(word => lowerText.includes(word));
    expect(mentionsNumber, `Poem should mention the number ${digit} or its word form`).to.be.true;

    expectLinkCount(space, 0);
  },
};
