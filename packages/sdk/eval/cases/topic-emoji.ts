import { expect } from 'chai';
import type { TestCase } from '../types.js';


const BOAT_EMOJIS = new Set(['⛵', '🚤', '🛶', '🚢']);

const prompt = `Add a new field named emoji to the object with a relevant emoji`;

/**
 * Tests that the AI can add an appropriate emoji to a topic node.
 */
export const testCase: TestCase = {
  description: 'Adds a boat emoji to a sailboat topic node',

  async run(client) {
    const space = await client.createSpace('EVAL: topic-emoji');
    const channel = await space.openChannel('console');

    try {
      const conversation = channel.conversation('topic-emoji-eval');
      await conversation.createCollection('topic', [
        { name: 'headline', type: { kind: 'string' } },
        { name: 'emoji', type: { kind: 'maybe', inner: { kind: 'string' } } },
      ]);

      // Create a single topic node
      const { object: createdTopic } = await conversation.createObject(
        'topic',
        { headline: 'Types of Sailboats' },
        { basename: 'sailboats' },
      );
      const topicLocation = createdTopic.location;

      // Run the prompt with the topic node selected
      await conversation.prompt(prompt, { locations: [topicLocation] });

      // Verify structure unchanged (still exactly one object, at the same location)
      const locations = channel.getObjectLocations();
      expect(locations).to.have.length(1);
      expect(locations[0]).to.equal(topicLocation);

      // Verify emoji was added and is boat-related
      const topic = await channel.getObject(topicLocation);
      expect(topic!.collection).to.equal('topic');
      expect(topic!.body.headline).to.equal('Types of Sailboats');
      expect(topic!.body.emoji).to.be.a('string');

      // Normalize emoji (remove variation selectors)
      const emoji = (topic!.body.emoji as string).replace(/\uFE0F/g, '');
      expect(BOAT_EMOJIS.has(emoji), `Expected boat emoji, got: ${topic!.body.emoji}`).to.be.true;
    } finally {
      space.close();
    }
  },
};
