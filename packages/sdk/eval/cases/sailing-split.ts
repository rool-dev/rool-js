import { expect } from 'chai';
import type { TestCase } from '../types.js';

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

const prompt = `Convert the selected markdown node into a topic node, keeping the same headline.
Then create markdown child nodes for each logical segment of the original text.
Each child should have a "parent" field referencing the topic node's ID.

Each object should have:
- type: "markdown" | "topic"
- headline: string
- text: string
- parent: <id> (for children only)
`;

/**
 * Tests that the AI can split a markdown node into a topic with child segments.
 */
export const testCase: TestCase = {
  description: 'Converts a markdown node to a topic and creates referenced child segments',

  async run(client) {
    const space = await client.createSpace('EVAL: sailing-split');

    try {
      // Create the initial markdown node
      const { object: initialNode } = await space.createObject({
        data: {
          type: 'markdown',
          headline: 'History of Sailing',
          text: SAILING_TEXT,
        },
        ephemeral: true,
      });
      const nodeId = initialNode.id;

      // Run the prompt with the node selected
      const { objects } = await space.prompt(prompt, { objectIds: [nodeId] });

      // Verify the original node was converted to a topic
      const convertedNode = await space.getObject(nodeId);
      expect(convertedNode!.type).to.equal('topic', 'Original node should be converted to topic');
      expect(convertedNode!.headline).to.equal('History of Sailing', 'Headline should be preserved');

      // Find new markdown children
      const newMarkdowns = objects.filter(
        o => o.id !== nodeId && o.type === 'markdown'
      );
      expect(newMarkdowns.length).to.be.at.least(2, 'Should create at least 2 markdown children');

      // Verify each new markdown has required fields
      for (const md of newMarkdowns) {
        expect(md.headline).to.be.a('string');
        expect((md.headline as string).length).to.be.greaterThan(0, 'Markdown should have headline');
        expect(md.text).to.be.a('string');
        expect((md.text as string).length).to.be.greaterThan(0, 'Markdown should have text');
      }

      // Verify each child references the topic via "parent"
      for (const md of newMarkdowns) {
        expect(md.parent, `Child ${md.id} should have parent field`).to.equal(nodeId);
      }
    } finally {
      space.close();
    }
  },
};
