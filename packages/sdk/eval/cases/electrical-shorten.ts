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
      const initialLocations = channel.getObjectLocations();
      const initialArticleBodyLengths = new Map<string, number>();
      const initialUntouchedData = new Map<string, string>();

      for (const location of initialLocations) {
        const obj = await channel.getObject(location);
        if (obj!.collection === 'Article' && typeof obj!.body.articleBody === 'string') {
          initialArticleBodyLengths.set(location, (obj!.body.articleBody as string).length);
        } else {
          initialUntouchedData.set(location, JSON.stringify(obj));
        }
      }

      // Run the prompt
      await conversation.prompt(prompt);

      // Verify structure unchanged: same objects
      const finalLocations = channel.getObjectLocations();
      expect(finalLocations.sort()).to.deep.equal(initialLocations.sort());

      // Verify objects without articleBody are unchanged
      for (const [location, initialData] of initialUntouchedData) {
        const finalObj = await channel.getObject(location);
        expect(JSON.stringify(finalObj)).to.equal(
          initialData,
          `Object ${location} (no articleBody) should be unchanged`
        );
      }

      // Verify articleBody was shortened
      for (const [location, initialLength] of initialArticleBodyLengths) {
        const finalObj = await channel.getObject(location);
        expect(finalObj!.collection).to.equal('Article');
        expect(finalObj!.body.articleBody).to.be.a('string');

        const finalLength = (finalObj!.body.articleBody as string).length;
        expect(finalLength).to.be.greaterThan(0, `Object ${location} articleBody should not be empty`);
        expect(finalLength).to.be.lessThan(
          initialLength,
          `Object ${location} articleBody should be shorter (was ${initialLength}, now ${finalLength})`
        );
      }
    } finally {
      space.close();
    }
  },
};
