import { expect } from 'chai';
import type { TestCase } from '../types.js';
import { expectLinkCount, expectValidUniqueUrls, expectUrlsFetchable } from '../helpers.js';

/**
 * Tests web search and image URL extraction.
 * Validates that the AI can find different images from the web.
 */
export const testCase: TestCase = {
  description: 'Creates three cheese image nodes from the web with unique URLs',

  async run(client) {
    const space = await client.createSpace('EVAL: cheese-images');

    try {
      const { objects } = await space.prompt(`
        Create three new nodes, each with a different image of cheese from the web.
        - Each node should store the image URL in an "imageUrl" field.
        - Do not add any edges.
      `);

      expect(objects).to.have.length(3);
      expectValidUniqueUrls(objects, 'imageUrl');
      await expectUrlsFetchable(space, objects, 'imageUrl');
      expectLinkCount(space, 0);
    } finally {
      space.close();
    }
  },
};
