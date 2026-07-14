import { expect } from 'chai';
import type { TestCase } from '../types.js';
import { conversationBranch, generateEntityId } from '../../src/space-session.js';

/**
 * Tests branching conversations: parentInteractionId creates a tree,
 * and the agent sees the correct history for each branch.
 */
export const testCase: TestCase = {
  description: 'Branching conversations — agent sees correct history per branch',

  async run(client) {
    const space = await client.createSpace('EVAL: branching-conversation');
    const conv = space.conversation(generateEntityId());

    try {
      const aId = generateEntityId();
      await conv.prompt('My favorite color is blue. Just say OK.', {
        readOnly: true,
        effort: 'QUICK',
        interactionId: aId,
        parentInteractionId: null,
      });

      const bId = generateEntityId();
      const { message: blue } = await conv.prompt(
        'What is my favorite color? Reply with ONLY the color name, one word.',
        { readOnly: true, effort: 'QUICK', interactionId: bId, parentInteractionId: aId },
      );
      expect(blue.toLowerCase()).to.include('blue');

      const cId = generateEntityId();
      await conv.prompt('My favorite color is red. Just say OK.', {
        readOnly: true,
        effort: 'QUICK',
        interactionId: cId,
        parentInteractionId: aId,
      });

      const dId = generateEntityId();
      const { message: red } = await conv.prompt(
        'What is my favorite color? Reply with ONLY the color name, one word.',
        { readOnly: true, effort: 'QUICK', interactionId: dId, parentInteractionId: cId },
      );
      expect(red.toLowerCase()).to.include('red');
      expect(red.toLowerCase()).to.not.include('blue');

      const conversation = await conv.get();
      expect(conversation).to.not.equal(null);
      const tree = conversation!.interactions;
      expect(Object.keys(tree)).to.have.length(4);
      expect(tree[aId].parentId).to.be.null;
      expect(tree[bId].parentId).to.equal(aId);
      expect(tree[cId].parentId).to.equal(aId);
      expect(tree[dId].parentId).to.equal(cId);

      const blueBranch = conversationBranch(conversation, bId);
      expect(blueBranch.map((interaction) => interaction.id)).to.deep.equal([aId, bId]);

      const redBranch = conversationBranch(conversation, dId);
      expect(redBranch.map((interaction) => interaction.id)).to.deep.equal([aId, cId, dId]);
    } finally {
      space.close();
    }
  },
};
