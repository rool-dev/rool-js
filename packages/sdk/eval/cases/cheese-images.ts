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

    try {
      const conversation = space.conversation('cheese-images-eval');
      const { objects } = await conversation.prompt(`Create three image objects with an image of cheese from the web. Each object should store the image URL in an "contentUrl" field.`);

      expect(objects).to.have.length(3);
      expectValidUniqueUrls(objects, 'contentUrl');
      await expectUrlsFetchable(space, objects, 'contentUrl');
    } finally {
      space.close();
    }
  },
};
