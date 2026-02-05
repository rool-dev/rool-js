import { expect } from 'chai';
import type { TestCase } from '../types.js';
import { expectLinkCount, loadArchiveFixture } from '../helpers.js';

// Expected image-search objects in the electrical fixture
const EXPECTED_IMAGE_NODE_IDS = new Set(['2TvtH2', '86Trm4']);

/**
 * Tests findObjects to locate all objects with images.
 */
export const testCase: TestCase = {
  description: 'Finds all objects containing images using semantic search',

  async run(client) {
    // Import the fixture
    const archive = loadArchiveFixture('electrical');
    const space = await client.importArchive('EVAL: find-images', archive);

    try {
      // Capture initial state
      const initialObjectIds = space.getObjectIds();

      // Use findObjects with semantic search to find image nodes
      const { objects } = await space.findObjects({
        prompt: 'Find all objects that contain images',
      });

      // Should find exactly the 2 image-search nodes
      expect(objects.length).to.equal(2, 'Should find exactly 2 image objects');

      // Verify we found the expected nodes
      const foundIds = new Set(objects.map(o => o.id));
      expect(foundIds).to.deep.equal(EXPECTED_IMAGE_NODE_IDS, 'Should find the expected image nodes');

      // Verify all found objects have imageUrl
      for (const obj of objects) {
        expect(obj.imageUrl).to.be.a('string');
        expect((obj.imageUrl as string).startsWith('https://')).to.be.true;
      }

      // Verify space was not modified
      const finalObjectIds = space.getObjectIds();
      expect(finalObjectIds.sort()).to.deep.equal(initialObjectIds.sort());
      expectLinkCount(space, 8);
    } finally {
      space.close();
    }
  },
};
