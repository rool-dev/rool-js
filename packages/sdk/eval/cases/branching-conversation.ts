import { expect } from 'chai';
import type { TestCase } from '../types.js';
import { generateEntityId } from '../../src/channel.js';

/**
 * Tests branching conversations: parentInteractionId creates a tree,
 * and the agent sees the correct history for each branch.
 */
export const testCase: TestCase = {
  description: 'Branching conversations — agent sees correct history per branch',

  async run(client) {
    const space = await client.createSpace('EVAL: branching-conversation');
    const channel = await space.openChannel(generateEntityId());
    const conv = channel.conversation(generateEntityId());

    try {
      // --- Linear chain: A → B ---

      // A: tell the agent a fact
      const { message: msgA } = await conv.prompt(
        'My favorite color is blue. Just say OK.',
        { readOnly: true, effort: 'QUICK' },
      );
      const leafAfterA = conv.activeLeafId;
      expect(leafAfterA).to.be.a('string');

      // B: follow-up, should know the color
      const { message: msgB } = await conv.prompt(
        'What is my favorite color? Reply with ONLY the color name, one word.',
        { readOnly: true, effort: 'QUICK' },
      );
      expect(msgB.toLowerCase()).to.include('blue');

      const leafAfterB = conv.activeLeafId;
      expect(leafAfterB).to.not.equal(leafAfterA);

      // --- Branch: A → C (sibling of B, same parent = A) ---

      // C: tell the agent a different fact, branching from A
      const { message: msgC } = await conv.prompt(
        'My favorite color is red. Just say OK.',
        { readOnly: true, effort: 'QUICK', parentInteractionId: leafAfterA },
      );
      const leafAfterC = conv.activeLeafId;

      // D: follow-up on the red branch
      const { message: msgD } = await conv.prompt(
        'What is my favorite color? Reply with ONLY the color name, one word.',
        { readOnly: true, effort: 'QUICK' },
      );
      expect(msgD.toLowerCase()).to.include('red');
      expect(msgD.toLowerCase()).to.not.include('blue');

      // --- Verify tree structure ---

      const tree = conv.getTree();
      const nodeCount = Object.keys(tree).length;
      expect(nodeCount).to.equal(4); // A, B, C, D

      // A is root
      expect(tree[leafAfterA!].parentId).to.be.null;

      // B and C are both children of A (siblings)
      expect(tree[leafAfterB!].parentId).to.equal(leafAfterA);
      expect(tree[leafAfterC!].parentId).to.equal(leafAfterA);

      // --- Switch back to blue branch and verify getInteractions ---

      conv.setActiveLeaf(leafAfterB!);
      const blueBranch = conv.getInteractions();
      expect(blueBranch).to.have.length(2); // A, B
      expect(blueBranch[0].id).to.equal(leafAfterA);
      expect(blueBranch[1].id).to.equal(leafAfterB);

      // Switch to red branch tip (D)
      const leafAfterD = conv.activeLeafId; // was set to D before setActiveLeaf
      conv.setActiveLeaf(leafAfterB!); // we switched to B above
      // find D's ID from tree
      const dId = Object.keys(tree).find(id =>
        tree[id].parentId === leafAfterC && id !== leafAfterC
      );
      expect(dId).to.be.a('string');
      conv.setActiveLeaf(dId!);
      const redBranch = conv.getInteractions();
      expect(redBranch).to.have.length(3); // A, C, D

    } finally {
      conv.close?.();
      channel.close();
    }
  },
};
