import { expect } from 'chai';
import type { TestCase } from '../types.js';

const prompt = `
Create three new objects based on the contents of this topic.
- Two in the "image" collection with relevant images from the net
- One in the "markdown" collection with an info text for the topic

Each new object should have a "parent" field whose value is the location of this topic.
`;

/**
 * Tests that the AI can expand a topic node by creating child nodes.
 */
export const testCase: TestCase = {
  description: 'Expands a topic node with image and markdown children',

  async run(client) {
    const space = await client.createSpace('EVAL: topic-expand');
    const channel = await space.openChannel('console');

    try {
      const conversation = channel.conversation('topic-expand-eval');
      await conversation.createCollection('topic', [
        { name: 'headline', type: { kind: 'string' } },
      ]);

      // Create a single topic node
      const { object: createdTopic } = await conversation.createObject(
        'topic',
        { headline: 'Types of Sailboats' },
        { basename: 'sailboats' },
      );
      const topicLocation = createdTopic.location;

      // Run the prompt with the topic node selected
      const { objects } = await conversation.prompt(prompt, { locations: [topicLocation] });

      // Verify new objects were created (at least 3: 2 image + 1 markdown)
      expect(objects.length).to.be.at.least(3);

      // Count by collection
      const imageCount = objects.filter(o => o.collection === 'image').length;
      const markdownCount = objects.filter(o => o.collection === 'markdown').length;

      expect(imageCount).to.be.equal(2, 'Should have 2 image objects');
      expect(markdownCount).to.equal(1, 'Should have exactly 1 markdown object');

      // Verify each child references the topic via "parent"
      for (const obj of objects) {
        if (obj.location !== topicLocation) {
          expect(obj.body.parent, `Child ${obj.location} should have parent field`).to.equal(topicLocation);
        }
      }
    } finally {
      space.close();
    }
  },
};
