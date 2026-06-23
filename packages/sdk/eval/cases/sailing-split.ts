import { expect } from 'chai';
import type { TestCase } from '../types.js';
import { collectionOf, createCollectionWithRetry, objectPath } from '../helpers.js';

const SAILING_TEXT = `## The Ancient Origins of Sailing

Sailing has ancient roots, emerging as a critical means of trade, transportation, and exploration.
Before steam power, sailing vessels were the primary way to navigate the world's waters, enabling
cultural exchange and the Age of Discovery.

## The Age of Sail: Dominance and Advancements

The Age of Sail (mid-16th to mid-19th century) marked the peak of sailing ships in global trade and warfare.
Advances in ship design, rigging, and naval artillery transformed maritime power. Sailing warships became
instruments of geopolitical influence, with a nation's reach determined by the speed of its fleet.

## Decline of Commercial Sailing

In the late 19th century, steam power gradually replaced sail. Steam engines offered reliable schedules
and higher speeds, making sail economically uncompetitive. By the early 20th century, the era of commercial
sailing had ended.

## Modern Sailing: Recreation and Sport

Today sailing is primarily recreational, spanning offshore racing, cruising, and coastal day-sailing.
Its appeal endures through the challenge of mastering wind and water and the unique freedom it offers.`;

const prompt = `Move the attached markdown object into the topic collection, keeping the same headline.
Then create markdown child objects for each logical segment of the original text.
Each child should have a "parent" field whose value is the path of the topic object.

Each object should have:
- headline: string
- text: string
- parent: <topic path> (for children only)
`;

/**
 * Tests that the AI can split a markdown object into a topic with child segments.
 */
export const testCase: TestCase = {
  description: 'Converts a markdown object to a topic and creates referenced child segments',

  async run(client) {
    const space = await client.createSpace('EVAL: sailing-split');

    try {
      const conversation = space.conversation('sailing-split-eval');
      await createCollectionWithRetry(conversation, 'markdown', [
        { name: 'headline', type: { kind: 'string' } },
        { name: 'text', type: { kind: 'string' } },
        { name: 'parent', type: { kind: 'maybe', inner: { kind: 'ref' } } },
      ]);
      await createCollectionWithRetry(conversation, 'topic', [
        { name: 'headline', type: { kind: 'string' } },
        { name: 'text', type: { kind: 'maybe', inner: { kind: 'string' } } },
      ]);

      // Create the initial markdown object.
      const initialPath = objectPath('markdown', 'history-of-sailing');
      await conversation.putObject(initialPath, {
        headline: 'History of Sailing',
        text: SAILING_TEXT,
      });

      // Run the prompt with the object attached.
      const { objects } = await conversation.prompt(prompt, { attachments: [initialPath] });

      // Original markdown path should no longer resolve (it was moved into topic/).
      const stillThere = await space.getObject(initialPath);
      expect(stillThere, 'Original markdown path should be empty after move').to.be.undefined;

      // Find the topic object the agent produced.
      const topic = objects.find(o => collectionOf(o) === 'topic');
      expect(topic, 'Should produce a topic object').to.exist;
      expect(topic!.body.headline).to.equal('History of Sailing', 'Headline should be preserved');

      // Find new markdown children (anything in the markdown collection that's not the original).
      const newMarkdowns = objects.filter(o => collectionOf(o) === 'markdown' && o.path !== initialPath);
      expect(newMarkdowns.length).to.be.at.least(2, 'Should create at least 2 markdown children');

      // Verify each new markdown has required fields.
      for (const md of newMarkdowns) {
        expect(md.body.headline).to.be.a('string');
        expect((md.body.headline as string).length).to.be.greaterThan(0, 'Markdown should have headline');
        expect(md.body.text).to.be.a('string');
        expect((md.body.text as string).length).to.be.greaterThan(0, 'Markdown should have text');
      }

      // Verify each child references the topic via "parent" (path string).
      for (const md of newMarkdowns) {
        expect(md.body.parent, `Child ${md.path} should have parent field`).to.equal(topic!.path);
      }
    } finally {
      space.close();
    }
  },
};
