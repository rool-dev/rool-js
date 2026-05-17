import { expect } from 'chai';
import type { TestCase } from '../types.js';
import { loadArchiveFixture } from '../helpers.js';

// Article/MZpMsZ is "Wiring and Circuit Protection" - the expected result
const EXPECTED_NODE_ID = 'Article/MZpMsZ';

/**
 * Tests semantic search using findObjects to locate content about circuit protection.
 */
export const testCase: TestCase = {
  description: 'Finds objects about circuit protection using semantic search',

  async run(client) {
    // Import the fixture
    const archive = loadArchiveFixture('electrical-new');
    const space = await client.importArchive('EVAL: find-circuit-protection', archive);
    const channel = await space.openChannel('console');

    try {
      const conversation = channel.conversation('find-circuit-protection-eval');

      // Capture initial state
      const initialObjectIds = channel.getObjectIds();

      // Use findObjects with semantic search
      const { objects } = await conversation.findObjects({
        prompt: 'Find objects describing circuit protection',
      });

      // Should find exactly the circuit protection node
      expect(objects.length).to.equal(1, 'Should find exactly 1 object');
      expect(objects[0].id).to.equal(EXPECTED_NODE_ID, 'Should find the circuit protection node');

      // Verify the found object has expected content
      expect(objects[0].name).to.equal('Wiring and Circuit Protection');
      expect(objects[0].type).to.equal('Article');

      // Verify space was not modified
      const finalObjectIds = channel.getObjectIds();
      expect(finalObjectIds.sort()).to.deep.equal(initialObjectIds.sort());
    } finally {
      space.close();
    }
  },
};
