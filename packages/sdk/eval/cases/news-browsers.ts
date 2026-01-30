import { expect } from 'chai';
import type { TestCase } from '../types.js';
import { expectLinkCount } from '../helpers.js';

/**
 * Tests creation of browser nodes with URLs.
 * Validates URL field population for known news sites.
 */
export const testCase: TestCase = {
  description: 'Creates browser nodes for BBC, CNN, and dr.dk',

  async run(space) {
    const { objects } = await space.prompt(`
      Create browser objects for BBC, CNN, and dr.dk.
      Each object should have:
      - type: "browser"
      - headline: string
      - text: string
      - url: string
    `);

    expect(objects).to.have.length(3);

    for (const obj of objects) {
      expect(obj.type).to.equal('browser');
    }

    const hasUrlMatching = (pattern: RegExp): boolean =>
      objects.some(obj => typeof obj.url === 'string' && pattern.test(obj.url as string));

    expect(hasUrlMatching(/bbc\.(com|co\.uk)/), 'Should have BBC URL').to.be.true;
    expect(hasUrlMatching(/cnn\.com/), 'Should have CNN URL').to.be.true;
    expect(hasUrlMatching(/dr\.dk/), 'Should have DR URL').to.be.true;

    expectLinkCount(space, 0);
  },
};
