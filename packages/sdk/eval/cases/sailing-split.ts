import { expect } from 'chai';
import type { TestCase } from '../types.js';
import { loadArchiveFixture } from '../helpers.js';

const ORIGINAL_NODE_ID = 'Kj7mNp';

const prompt = `Convert the selected markdown node into a topic node, keeping the same headline.
Then create markdown child nodes for each logical segment of the original text.
Connect each child to the topic with outbound "expand" edges.

Each object should have:
- type: "markdown" | "topic"
- headline: string
- text: string
`;

/**
 * Tests that the AI can split a markdown node into a topic with child segments.
 */
export const testCase: TestCase = {
  description: 'Converts a markdown node to a topic and creates referenced child segments',

  async run(client) {
    // Import the fixture
    const archive = loadArchiveFixture('sailing');
    const space = await client.importArchive('EVAL: sailing-split', archive);

    try {
      // Verify initial state
      const initialNode = await space.getObject(ORIGINAL_NODE_ID);
      expect(initialNode!.type).to.equal('markdown');

      // Run the prompt with the node selected
      const { objects } = await space.prompt(prompt, { objectIds: [ORIGINAL_NODE_ID] });

      // Verify the original node was converted to a topic
      const convertedNode = await space.getObject(ORIGINAL_NODE_ID);
      expect(convertedNode!.type).to.equal('topic', 'Original node should be converted to topic');
      expect(convertedNode!.headline).to.equal('History of Sailing', 'Headline should be preserved');

      // Find new markdown children
      const newMarkdowns = objects.filter(
        o => o.id !== ORIGINAL_NODE_ID && o.type === 'markdown'
      );
      expect(newMarkdowns.length).to.be.at.least(2, 'Should create at least 2 markdown children');

      // Verify each new markdown has required fields
      for (const md of newMarkdowns) {
        expect(md.headline).to.be.a('string');
        expect((md.headline as string).length).to.be.greaterThan(0, 'Markdown should have headline');
        expect(md.text).to.be.a('string');
        expect((md.text as string).length).to.be.greaterThan(0, 'Markdown should have text');
      }

      // Verify the topic references its children via data fields
      const topicData = JSON.stringify(convertedNode);
      for (const md of newMarkdowns) {
        expect(topicData).to.include(md.id, `Topic should reference child ${md.id} in its data`);
      }
    } finally {
      space.close();
    }
  },
};
