import { expect } from 'chai';
import type { TestCase } from '../types.js';
import { collectionOf, listObjectPaths, loadArchiveFixture, parseJsonMessage } from '../helpers.js';

// "Wiring and Circuit Protection" — the expected result.
// The fixture imports as v1 (bare IDs); the server migrates basenames into
// the Article collection, so the canonical path is below.
const EXPECTED_PATH = '/space/Article/MZpMsZ.json';

/**
 * Tests semantic lookup using a read-only structured prompt.
 */
export const testCase: TestCase = {
  description: 'Finds objects about circuit protection using read-only prompt',

  async run(client) {
    // Import the fixture.
    const archive = loadArchiveFixture('electrical-new');
    const space = await client.importArchive('EVAL: find-circuit-protection', archive);
    const channel = await space.openChannel('console');

    try {
      const conversation = channel.conversation('find-circuit-protection-eval');

      // Capture initial state.
      const initialPaths = await listObjectPaths(space);

      const { message } = await conversation.prompt(
        'Find existing objects describing circuit protection. Return exactly the matching object paths.',
        {
          readOnly: true,
          responseSchema: {
            type: 'object',
            properties: { paths: { type: 'array', items: { type: 'string' } } },
            required: ['paths'],
            additionalProperties: false,
          },
        },
      );
      const { paths } = parseJsonMessage<{ paths: string[] }>(message);
      const { objects } = await channel.getObjects(paths);

      // Should find exactly the circuit protection object.
      expect(objects.length).to.equal(1, 'Should find exactly 1 object');
      expect(objects[0].path).to.equal(EXPECTED_PATH, 'Should find the circuit protection object');

      // Verify the found object has expected content.
      expect(objects[0].body.name).to.equal('Wiring and Circuit Protection');
      expect(collectionOf(objects[0])).to.equal('Article');

      // Verify space was not modified.
      const finalPaths = await listObjectPaths(space);
      expect(finalPaths.sort()).to.deep.equal(initialPaths.sort());
    } finally {
      space.close();
    }
  },
};
