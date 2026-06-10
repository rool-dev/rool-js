import { expect } from 'chai';
import type { TestCase } from '../types.js';
import { collectionOf, createCollectionWithRetry } from '../helpers.js';

/**
 * Tests creation of browser objects with URLs.
 * Validates URL field population for known news sites.
 */
export const testCase: TestCase = {
  description: 'Creates browser objects for BBC, CNN, and dr.dk',

  async run(client) {
    const space = await client.createSpace('EVAL: news-browsers');
    const channel = await space.openChannel('console');

    try {
      const conversation = channel.conversation('news-browsers-eval');
      await createCollectionWithRetry(conversation, 'browser', [
        { name: 'headline', type: { kind: 'string' } },
        { name: 'text', type: { kind: 'string' } },
        { name: 'url', type: { kind: 'string' } },
      ]);

      const { objects } = await conversation.prompt(`Create exactly three objects in the existing browser collection about BBC, CNN, and dr.dk. Do it from memory, no need to search. Each should have:
- headline: the name of the news media
- text: a description of the news media
- url: string`);

      expect(objects).to.have.length(3);
      for (const obj of objects) expect(collectionOf(obj)).to.equal('browser');

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
