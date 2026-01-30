import { expect } from 'chai';
import type { TestCase } from '../types.js';

const prompt = `
Create three new nodes based on the contents of this topic node.
- Two that has type "image" with relevant images from the net
- One with type "markdown" with an info to the topic

Connect the created nodes to the topic node with outbound "expand" edges from the topic.
`;

/**
 * Tests that the AI can expand a topic node by creating child nodes.
 */
export const testCase: TestCase = {
  description: 'Expands a topic node with image and markdown children',

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

    // Capture initial topic data
    const initialTopicJson = JSON.stringify(createdTopic);

    // Run the prompt with the topic node selected
    const { objects } = await space.prompt(prompt, { objectIds: [topicId] });

    // Verify new objects were created (at least 3: 2 image + 1 markdown)
    expect(objects.length).to.be.at.least(3);

    // Count by type
    const imageCount = objects.filter(o => o.type === 'image').length;
    const markdownCount = objects.filter(o => o.type === 'markdown').length;

    expect(imageCount).to.be.equal(2, 'Should have 2 image nodes');
    expect(markdownCount).to.equal(1, 'Should have exactly 1 markdown node');

    // Verify topic node is unchanged
    const finalTopic = await space.getObject(topicId);
    expect(JSON.stringify(finalTopic)).to.equal(initialTopicJson, 'Topic node data should be unchanged');

    // Verify all new nodes are linked from the topic with 'expand' relation
    const children = await space.getChildren(topicId, 'expand');
    expect(children.length).to.be.equal(3, 'Topic should have 3 expand children');

    // Verify all created objects are among the children
    const childIds = new Set(children.map(c => c.id));
    for (const obj of objects) {
      if (obj.id !== topicId) {
        expect(childIds.has(obj.id), `Object ${obj.id} should be linked from topic`).to.be.true;
      }
    }
  },
};
