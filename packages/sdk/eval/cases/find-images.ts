import { expect } from 'chai';
import type { TestCase } from '../types.js';
import { loadArchiveFixture } from '../helpers.js';

// Expected ImageObject nodes in the electrical fixture
const EXPECTED_IMAGE_NODE_IDS = new Set(['ImageObject/2TvtH2', 'ImageObject/86Trm4']);

/**
 * Tests findObjects to locate all objects with images.
 */
export const testCase: TestCase = {
  description: 'Finds image objects',

  async run(client) {
    // Import the fixture
    const archive = loadArchiveFixture('electrical-new');
    const space = await client.importArchive('EVAL: find-images', archive);
    const channel = await space.openChannel('console');

    try {
      const conversation = channel.conversation('find-images-eval');

      // Capture initial state
      const initialObjectIds = channel.getObjectIds();

      // Use findObjects with semantic search to find image nodes
      const { objects } = await conversation.findObjects({
        prompt: 'Find all image objects',
      });

      // Should find exactly the 2 ImageObject nodes
      expect(objects.length).to.equal(2, 'Should find exactly 2 image objects');

      // Verify we found the expected nodes
      const foundIds = new Set(objects.map(o => o.id));
      expect(foundIds).to.deep.equal(EXPECTED_IMAGE_NODE_IDS, 'Should find the expected image nodes');

      // Verify all found objects have contentUrl
      for (const obj of objects) {
        expect(obj.contentUrl).to.be.a('string');
        expect((obj.contentUrl as string).startsWith('https://')).to.be.true;
      }

      // Verify space was not modified
      const finalObjectIds = channel.getObjectIds();
      expect(finalObjectIds.sort()).to.deep.equal(initialObjectIds.sort());
    } finally {
      space.close();
    }
  },
};
