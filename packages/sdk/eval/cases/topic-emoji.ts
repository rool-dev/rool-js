import { expect } from 'chai';
import type { TestCase } from '../types.js';
import { createCollectionWithRetry, listObjectPaths, objectPath } from '../helpers.js';

const BOAT_EMOJIS = new Set(['⛵', '🚤', '🛶', '🚢']);

const prompt = `Add a new field named emoji to the attached object with a relevant emoji. Modify only that object.`;

/**
 * Tests that the AI can add an appropriate emoji to a topic node.
 */
export const testCase: TestCase = {
  description: 'Adds a boat emoji to a sailboat topic node',

  async run(client) {
    const space = await client.createSpace('EVAL: topic-emoji');

    try {
      const conversation = space.conversation('topic-emoji-eval');
      await createCollectionWithRetry(space, 'topic', [
        { name: 'headline', type: { kind: 'string' } },
        { name: 'emoji', type: { kind: 'maybe', inner: { kind: 'string' } } },
      ]);

      const topicPath = objectPath('topic', 'sailboats');
      await space.putObject(topicPath, { headline: 'Types of Sailboats' });

      // Run the prompt with the topic object attached.
      await conversation.prompt(prompt, { attachments: [topicPath] });

      // Verify structure unchanged (still exactly one object, at the same path).
      const paths = await listObjectPaths(space);
      expect(paths).to.deep.equal([topicPath]);

      // Verify emoji was added and is boat-related.
      const topic = await space.getObject(topicPath);
      expect(topic!.path).to.equal(topicPath);
      expect(topic!.body.headline).to.equal('Types of Sailboats');
      expect(topic!.body.emoji).to.be.a('string');

      // Normalize emoji (remove variation selectors).
      const emoji = (topic!.body.emoji as string).replace(/\uFE0F/g, '');
      expect(BOAT_EMOJIS.has(emoji), `Expected boat emoji, got: ${topic!.body.emoji}`).to.be.true;
    } finally {
      space.close();
    }
  },
};
