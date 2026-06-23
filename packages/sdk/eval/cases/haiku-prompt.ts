import { expect } from 'chai';
import type { TestCase } from '../types.js';
import { collectionOf, createCollectionWithRetry } from '../helpers.js';

/**
 * Tests the prompt() API by creating haiku objects.
 * Validates that the AI can create structured content with specific field requirements.
 */
export const testCase: TestCase = {
  description: 'Creates three markdown haiku objects via prompt',

  async run(client) {
    const space = await client.createSpace('EVAL: haiku-prompt');

    try {
      const conversation = space.conversation('haiku-prompt-eval');
      await createCollectionWithRetry(conversation, 'markdown', [
        { name: 'headline', type: { kind: 'string' } },
        { name: 'text', type: { kind: 'string' } },
      ]);

      const { objects } = await conversation.prompt(`
        Create three objects in the existing markdown collection with the following fields:
        - headline: string (title for the haiku)
        - text: string (the haiku itself)

        Do not create any other objects.
      `);

      expect(objects).to.have.length(3);

      for (const obj of objects) {
        expect(collectionOf(obj)).to.equal('markdown');
        expect(obj.body.headline).to.be.a('string');
        expect((obj.body.headline as string).length).to.be.greaterThan(0);
        expect(obj.body.text).to.be.a('string');
        expect((obj.body.text as string).length).to.be.greaterThan(0);

        // Text should have at least 3 lines (haiku structure).
        const lines = (obj.body.text as string)
          .split(/\r?\n/)
          .map(l => l.trim())
          .filter(Boolean);
        expect(lines.length).to.be.at.least(3);

        // Lines should be short (haiku constraint: each line typically <= 8 words).
        for (const line of lines.slice(0, 3)) {
          const wordCount = line.split(/\s+/).length;
          expect(wordCount).to.be.at.most(8);
        }
      }
    } finally {
      space.close();
    }
  },
};
