import { expect } from 'chai';
import type { TestCase } from '../types.js';

const prompt = `
Create three new nodes based on the contents of this topic node.
- Two that has type "image" with relevant images from the net
- One with type "markdown" with an info to the topic

Each new node should have a "parent" field referencing the topic node's ID.
`;

/**
 * Tests that the AI can expand a topic node by creating child nodes.
 */
export const testCase: TestCase = {
  description: 'Expands a topic node with image and markdown children',

  async run(client) {
    const space = await client.createSpace('EVAL: topic-expand');

    try {
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
      const { objects } = await space.prompt(prompt, { objectIds: [topicId] });

      // Verify new objects were created (at least 3: 2 image + 1 markdown)
      expect(objects.length).to.be.at.least(3);

      // Count by type
      const imageCount = objects.filter(o => o.type === 'image').length;
      const markdownCount = objects.filter(o => o.type === 'markdown').length;

      expect(imageCount).to.be.equal(2, 'Should have 2 image nodes');
      expect(markdownCount).to.equal(1, 'Should have exactly 1 markdown node');

      // Verify each child references the topic via "parent"
      for (const obj of objects) {
        if (obj.id !== topicId) {
          expect(obj.parent, `Child ${obj.id} should have parent field`).to.equal(topicId);
        }
      }
    } finally {
      space.close();
    }
  },
};
