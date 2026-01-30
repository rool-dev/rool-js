import { expect } from 'chai';
import type { TestCase } from '../types.js';
import { loadFixture } from '../helpers.js';

const fixture = loadFixture('sailing');

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
  description: 'Converts a markdown node to a topic and creates linked child segments',

  async run(space) {
    // Import the fixture
    await space.import(fixture);

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

    // Verify children are linked from the original node with 'expand' relation
    const children = await space.getChildren(ORIGINAL_NODE_ID, 'expand');
    expect(children.length).to.be.at.least(2, 'Should have at least 2 expand children');

    // Verify all new markdowns are among the children
    const childIds = new Set(children.map(c => c.id));
    for (const md of newMarkdowns) {
      expect(childIds.has(md.id), `Markdown ${md.id} should be linked from topic`).to.be.true;
    }
  },
};
