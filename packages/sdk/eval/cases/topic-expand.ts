import { expect } from 'chai';
import type { TestCase } from '../types.js';
import { collectionOf, createCollectionWithRetry, objectPath } from '../helpers.js';

const prompt = `
Create three new objects based on the attached topic object.
- Two in the "image" collection with relevant image URLs from the web
- One in the "markdown" collection with an info text for the topic

Each new object should have a "parent" field whose value is the path of the topic object.
`;

/**
 * Tests that the AI can expand a topic node by creating child nodes.
 */
export const testCase: TestCase = {
  description: 'Expands a topic node with image and markdown children',

  async run(client) {
    const space = await client.createSpace('EVAL: topic-expand');

    try {
      const conversation = space.conversation('topic-expand-eval');
      await createCollectionWithRetry(space, 'topic', [
        { name: 'headline', type: { kind: 'string' } },
      ]);
      await createCollectionWithRetry(space, 'image', [
        { name: 'headline', type: { kind: 'string' } },
        { name: 'image_url', type: { kind: 'string' } },
        { name: 'parent', type: { kind: 'ref' } },
      ]);
      await createCollectionWithRetry(space, 'markdown', [
        { name: 'headline', type: { kind: 'string' } },
        { name: 'text', type: { kind: 'string' } },
        { name: 'parent', type: { kind: 'ref' } },
      ]);

      const topicPath = objectPath('topic', 'sailboats');
      await space.putObject(topicPath, { headline: 'Types of Sailboats' });

      const { objects } = await conversation.prompt(prompt, { attachments: [topicPath] });

      // Verify new objects were created (at least 3: 2 image + 1 markdown).
      const children = objects.filter(o => o.path !== topicPath);
      expect(children.length).to.be.at.least(3);

      const imageCount = children.filter(o => collectionOf(o) === 'image').length;
      const markdownCount = children.filter(o => collectionOf(o) === 'markdown').length;

      expect(imageCount).to.equal(2, 'Should have 2 image objects');
      expect(markdownCount).to.equal(1, 'Should have exactly 1 markdown object');

      // Verify each child references the topic via "parent".
      for (const obj of children) {
        expect(obj.body.parent, `Child ${obj.path} should have parent field`).to.equal(topicPath);
      }
    } finally {
      space.close();
    }
  },
};
