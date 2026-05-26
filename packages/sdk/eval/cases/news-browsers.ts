import { expect } from 'chai';
import type { TestCase } from '../types.js';
import { expectCollectionWithFields } from '../helpers.js';


/**
 * Tests creation of browser nodes with URLs.
 * Validates URL field population for known news sites.
 */
export const testCase: TestCase = {
  description: 'Creates browser nodes for BBC, CNN, and dr.dk',

  async run(client) {
    const space = await client.createSpace('EVAL: news-browsers');
    const channel = await space.openChannel('console');

    try {
      const conversation = channel.conversation('news-browsers-eval');
      const { objects } = await conversation.prompt(`Create objects about BBC, CNN, and dr.dk. Do it from memory, no need to search. Each should have:
- type: "browser"
- headline: the name of the news media
- text: a description of the news media
- url: string`);

      expect(objects).to.have.length(3);

      // Verify schema has a collection with headline and url fields
      expectCollectionWithFields(channel, ['headline', 'url']);

      const hasUrlMatching = (pattern: RegExp): boolean =>
        objects.some(obj => typeof obj.body.url === 'string' && pattern.test(obj.body.url as string));

      expect(hasUrlMatching(/bbc\.(com|co\.uk)/), 'Should have BBC URL').to.be.true;
      expect(hasUrlMatching(/cnn\.com/), 'Should have CNN URL').to.be.true;
      expect(hasUrlMatching(/dr\.dk/), 'Should have DR URL').to.be.true;

    } finally {
      space.close();
    }
  },
};
