import { expect } from 'chai';
import type { TestCase } from '../types.js';
import { expectValidUniqueUrls, expectUrlsFetchable } from '../helpers.js';

/**
 * Tests web search and image URL extraction.
 * Validates that the AI can find different images from the web.
 */
export const testCase: TestCase = {
  description: 'Creates three cheese image objects from the web with unique URLs',

  async run(client) {
    const space = await client.createSpace('EVAL: cheese-images');
    const channel = await space.openChannel('console');

    try {
      const conversation = channel.conversation('cheese-images-eval');
      const { objects } = await conversation.prompt(`Create three image objects with an image of cheese from the web. Each object should store the image URL in an "contentUrl" field.`);

      expect(objects).to.have.length(3);
      expectValidUniqueUrls(objects, 'contentUrl');
      await expectUrlsFetchable(channel, objects, 'contentUrl');
    } finally {
      space.close();
    }
  },
};
