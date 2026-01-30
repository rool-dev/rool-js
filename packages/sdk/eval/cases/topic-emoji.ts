import { expect } from 'chai';
import type { TestCase } from '../types.js';
import { expectLinkCount } from '../helpers.js';

const BOAT_EMOJIS = new Set(['⛵', '🚤', '🛶', '🚢']);

const prompt = `Add a new field named emoji to the object with a relevant emoji`;

/**
 * Tests that the AI can add an appropriate emoji to a topic node.
 */
export const testCase: TestCase = {
  description: 'Adds a boat emoji to a sailboat topic node',

  async run(space) {
    // Create a single topic node
    const { object: createdTopic } = await space.createObject({
      data: {
        id: 'Xr4tQw',
        type: 'topic',
        headline: 'Types of Sailboats',
      },
    });
    const topicId = createdTopic.id;

    // Run the prompt with the topic node selected
    await space.prompt(prompt, { objectIds: [topicId] });

    // Verify structure unchanged
    const objectIds = space.getObjectIds();
    expect(objectIds).to.have.length(1);
    expect(objectIds[0]).to.equal(topicId);
    expectLinkCount(space, 0);

    // Verify emoji was added and is boat-related
    const topic = await space.getObject(topicId);
    expect(topic!.type).to.equal('topic');
    expect(topic!.headline).to.equal('Types of Sailboats');
    expect(topic!.emoji).to.be.a('string');

    // Normalize emoji (remove variation selectors)
    const emoji = (topic!.emoji as string).replace(/\uFE0F/g, '');
    expect(BOAT_EMOJIS.has(emoji), `Expected boat emoji, got: ${topic.emoji}`).to.be.true;
  },
};
