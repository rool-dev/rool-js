import { expect } from 'chai';
import type { TestCase } from '../types.js';
import { expectLinkCount, loadArchiveFixture } from '../helpers.js';

const prompt = `For every markdown node, regenerate prose for the \`text\` field. The shortened text should be at least 30% shorter`;

/**
 * Tests that the AI can shorten markdown text while preserving graph structure.
 * Uses the electrical systems fixture as initial state.
 */
export const testCase: TestCase = {
  description: 'Shortens text in all markdown nodes while preserving graph structure',

  async run(client) {
    // Import the fixture
    const archive = loadArchiveFixture('electrical');
    const space = await client.importArchive('EVAL: electrical-shorten', archive);

    try {
      // Capture initial state
      const initialObjectIds = space.getObjectIds();
      const initialMarkdownTexts = new Map<string, number>();
      const initialNonMarkdownData = new Map<string, string>();

      for (const id of initialObjectIds) {
        const obj = await space.getObject(id);
        if (obj!.type === 'markdown') {
          const text = obj!.text as string;
          initialMarkdownTexts.set(id, text?.length ?? 0);
        } else {
          initialNonMarkdownData.set(id, JSON.stringify(obj));
        }
      }

      // Run the prompt
      await space.prompt(prompt);

      // Verify structure unchanged: same objects
      const finalObjectIds = space.getObjectIds();
      expect(finalObjectIds.sort()).to.deep.equal(initialObjectIds.sort());

      // Verify link count unchanged (8 links in electrical fixture)
      expectLinkCount(space, 8);

      // Verify non-markdown objects unchanged
      for (const [id, initialData] of initialNonMarkdownData) {
        const finalObj = await space.getObject(id);
        expect(JSON.stringify(finalObj)).to.equal(
          initialData,
          `Non-markdown object ${id} should be unchanged`
        );
      }

      // Verify markdown text was shortened
      for (const [id, initialLength] of initialMarkdownTexts) {
        const finalObj = await space.getObject(id);
        expect(finalObj!.type).to.equal('markdown');
        expect(finalObj!.text).to.be.a('string');

        const finalLength = (finalObj!.text as string).length;
        expect(finalLength).to.be.greaterThan(0, `Object ${id} text should not be empty`);
        expect(finalLength).to.be.lessThan(
          initialLength,
          `Object ${id} text should be shorter (was ${initialLength}, now ${finalLength})`
        );
      }
    } finally {
      space.close();
    }
  },
};
