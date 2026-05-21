import { expect } from 'chai';
import type { TestCase } from '../types.js';
import { loadArchiveFixture } from '../helpers.js';

// "Wiring and Circuit Protection" — the expected result.
// The fixture imports as v1 (bare IDs); the server migrates basenames into
// the Article collection, so the canonical location is below.
const EXPECTED_LOCATION = '/space/Article/MZpMsZ.json';

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
      const initialLocations = channel.getObjectLocations();

      // Use findObjects with semantic search
      const { objects } = await conversation.findObjects({
        prompt: 'Find objects describing circuit protection',
      });

      // Should find exactly the circuit protection node
      expect(objects.length).to.equal(1, 'Should find exactly 1 object');
      expect(objects[0].location).to.equal(EXPECTED_LOCATION, 'Should find the circuit protection node');

      // Verify the found object has expected content
      expect(objects[0].body.name).to.equal('Wiring and Circuit Protection');
      expect(objects[0].collection).to.equal('Article');

      // Verify space was not modified
      const finalLocations = channel.getObjectLocations();
      expect(finalLocations.sort()).to.deep.equal(initialLocations.sort());
    } finally {
      space.close();
    }
  },
};
