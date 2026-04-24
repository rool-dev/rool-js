import { expect } from 'chai';
import type { TestCase } from '../types.js';
import { expectValidUniqueUrls, expectUrlsFetchable } from '../helpers.js';

/**
 * Tests web search and image URL extraction.
 * Validates that the AI can find different images from the web.
 */
export const testCase: TestCase = {
  description: 'Creates three cheese image nodes from the web with unique URLs',

  async run(client) {
    const space = await client.createSpace('EVAL: cheese-images');
    const channel = await space.openChannel('console');

    try {
      const { objects } = await channel.prompt(`
        Create three new nodes, each with a different image of cheese from the web.
        - Each node should store the image URL in an "imageUrl" field.
        - Do not add any edges.
      `);

      expect(objects).to.have.length(3);
      expectValidUniqueUrls(objects, 'imageUrl');
      await expectUrlsFetchable(channel, objects, 'imageUrl');
    } finally {
      channel.close();
    }
  },
};
