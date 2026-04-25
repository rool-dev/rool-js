import { expect } from 'chai';
import type { TestCase } from '../types.js';
import { expectCollectionWithFields } from '../helpers.js';


/**
 * Tests the prompt() API by creating haiku nodes.
 * Validates that the AI can create structured content with specific field requirements.
 */
export const testCase: TestCase = {
  description: 'Creates three markdown haiku nodes via prompt',

  async run(client) {
    const space = await client.createSpace('EVAL: haiku-prompt');
    const channel = await space.openChannel('console');

    try {
      const { objects } = await channel.prompt(`
        Create three markdown nodes with the following fields:
        - type: "markdown"
        - headline: string (title for the haiku)
        - text: string (the haiku itself)

        Do not add any edges.
      `);

      expect(objects).to.have.length(3);

      // Verify schema has a collection with headline and text
      expectCollectionWithFields(channel, ['headline', 'text']);

      for (const obj of objects) {
        expect(obj.headline).to.be.a('string');
        expect((obj.headline as string).length).to.be.greaterThan(0);
        expect(obj.text).to.be.a('string');
        expect((obj.text as string).length).to.be.greaterThan(0);

        // Text should have at least 3 lines (haiku structure)
        const lines = (obj.text as string)
          .split(/\r?\n/)
          .map(l => l.trim())
          .filter(Boolean);
        expect(lines.length).to.be.at.least(3);

        // Lines should be short (haiku constraint: each line typically <= 8 words)
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
