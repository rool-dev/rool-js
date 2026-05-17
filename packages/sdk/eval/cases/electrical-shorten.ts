import { expect } from 'chai';
import type { TestCase } from '../types.js';
import { loadArchiveFixture } from '../helpers.js';

const prompt = `For every Article that has an \`articleBody\`, regenerate prose for the \`articleBody\` field. The shortened text should be at least 30% shorter`;

/**
 * Tests that the AI can shorten article prose while preserving graph structure.
 * Uses the electrical systems fixture as initial state.
 */
export const testCase: TestCase = {
  description: 'Shortens articleBody in all Article nodes while preserving graph structure',

  async run(client) {
    // Import the fixture
    const archive = loadArchiveFixture('electrical-new');
    const space = await client.importArchive('EVAL: electrical-shorten', archive);
    const channel = await space.openChannel('console');

    try {
      const conversation = channel.conversation('electrical-shorten-eval');

      // Capture initial state
      const initialObjectIds = channel.getObjectIds();
      const initialArticleBodyLengths = new Map<string, number>();
      const initialUntouchedData = new Map<string, string>();

      for (const id of initialObjectIds) {
        const obj = await channel.getObject(id);
        if (obj!.type === 'Article' && typeof obj!.articleBody === 'string') {
          initialArticleBodyLengths.set(id, (obj!.articleBody as string).length);
        } else {
          initialUntouchedData.set(id, JSON.stringify(obj));
        }
      }

      // Run the prompt
      await conversation.prompt(prompt);

      // Verify structure unchanged: same objects
      const finalObjectIds = channel.getObjectIds();
      expect(finalObjectIds.sort()).to.deep.equal(initialObjectIds.sort());

      // Verify objects without articleBody are unchanged
      for (const [id, initialData] of initialUntouchedData) {
        const finalObj = await channel.getObject(id);
        expect(JSON.stringify(finalObj)).to.equal(
          initialData,
          `Object ${id} (no articleBody) should be unchanged`
        );
      }

      // Verify articleBody was shortened
      for (const [id, initialLength] of initialArticleBodyLengths) {
        const finalObj = await channel.getObject(id);
        expect(finalObj!.type).to.equal('Article');
        expect(finalObj!.articleBody).to.be.a('string');

        const finalLength = (finalObj!.articleBody as string).length;
        expect(finalLength).to.be.greaterThan(0, `Object ${id} articleBody should not be empty`);
        expect(finalLength).to.be.lessThan(
          initialLength,
          `Object ${id} articleBody should be shorter (was ${initialLength}, now ${finalLength})`
        );
      }
    } finally {
      space.close();
    }
  },
};
