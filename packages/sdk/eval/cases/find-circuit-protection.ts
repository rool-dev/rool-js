import { expect } from 'chai';
import type { TestCase } from '../types.js';
import { expectLinkCount, loadFixture } from '../helpers.js';

const fixture = loadFixture('electrical');

// MZpMsZ is "Wiring and Circuit Protection" - the expected result
const EXPECTED_NODE_ID = 'MZpMsZ';

/**
 * Tests semantic search using findObjects to locate content about circuit protection.
 */
export const testCase: TestCase = {
  description: 'Finds objects about circuit protection using semantic search',

  async run(space) {
    // Import the fixture
    await space.import(fixture);

    // Capture initial state
    const initialObjectIds = space.getObjectIds();

    // Use findObjects with semantic search
    const { objects } = await space.findObjects({
      prompt: 'Find objects describing circuit protection',
    });

    // Should find exactly the circuit protection node
    expect(objects.length).to.equal(1, 'Should find exactly 1 object');
    expect(objects[0].id).to.equal(EXPECTED_NODE_ID, 'Should find the circuit protection node');

    // Verify the found object has expected content
    expect(objects[0].headline).to.equal('Wiring and Circuit Protection');
    expect(objects[0].type).to.equal('markdown');

    // Verify space was not modified
    const finalObjectIds = space.getObjectIds();
    expect(finalObjectIds.sort()).to.deep.equal(initialObjectIds.sort());
    expectLinkCount(space, 8);
  },
};
