import { expect } from 'chai';
import type { TestCase } from '../types.js';
import { collectionOf, listObjectPaths, loadArchiveFixture } from '../helpers.js';

const prompt = `For every Article object that has an \`articleBody\`, regenerate prose for the \`articleBody\` field. The shortened text should be shorter than the original. Preserve every object path and do not modify objects without articleBody.`;

/**
 * Tests that the AI can shorten article prose while preserving graph structure.
 * Uses the electrical systems fixture as initial state.
 */
export const testCase: TestCase = {
  description: 'Shortens articleBody in all Article objects while preserving graph structure',

  async run(client) {
    // Import the fixture.
    const archive = loadArchiveFixture('electrical-new');
    const space = await client.importArchive('EVAL: electrical-shorten', archive);
    const channel = await space.openChannel('console');

    try {
      const conversation = channel.conversation('electrical-shorten-eval');

      // Capture initial state.
      const initialPaths = await listObjectPaths(space);
      const initialArticleBodyLengths = new Map<string, number>();
      const initialUntouchedData = new Map<string, string>();

      for (const path of initialPaths) {
        const obj = await channel.getObject(path);
        if (collectionOf(obj!) === 'Article' && typeof obj!.body.articleBody === 'string') {
          initialArticleBodyLengths.set(path, (obj!.body.articleBody as string).length);
        } else {
          initialUntouchedData.set(path, JSON.stringify(obj));
        }
      }

      // Run the prompt.
      await conversation.prompt(prompt);

      // Verify structure unchanged: same objects.
      const finalPaths = await listObjectPaths(space);
      expect(finalPaths.sort()).to.deep.equal(initialPaths.sort());

      // Verify objects without articleBody are unchanged.
      for (const [path, initialData] of initialUntouchedData) {
        const finalObj = await channel.getObject(path);
        expect(JSON.stringify(finalObj)).to.equal(
          initialData,
          `Object ${path} (no articleBody) should be unchanged`,
        );
      }

      // Verify articleBody was shortened.
      for (const [path, initialLength] of initialArticleBodyLengths) {
        const finalObj = await channel.getObject(path);
        expect(collectionOf(finalObj!)).to.equal('Article');
        expect(finalObj!.body.articleBody).to.be.a('string');

        const finalLength = (finalObj!.body.articleBody as string).length;
        expect(finalLength).to.be.greaterThan(0, `Object ${path} articleBody should not be empty`);
        expect(finalLength).to.be.lessThan(
          initialLength,
          `Object ${path} articleBody should be shorter (was ${initialLength}, now ${finalLength})`,
        );
      }
    } finally {
      space.close();
    }
  },
};
