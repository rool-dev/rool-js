import { expect } from 'chai';
import type { TestCase } from '../types.js';
import { expectCollectionWithFields } from '../helpers.js';


const EXPECTED_VALUE = (Math.E + Math.PI) ** 4; // ≈ 1179.107099469
/**
 * Tests that the AI can compute accurately using the eval_code tool.
 */
export const testCase: TestCase = {
  description: 'Creates an object with the computed value of e^5',

  async run(client) {
    const space = await client.createSpace('EVAL: math-test');
    const channel = await space.openChannel('console');

    try {
      const conversation = channel.conversation('math-test-eval');
      const { objects } = await conversation.prompt(`Create a new object with a fields named 'formula' and 'result' containing the value of (e+pi)^4`);

      // Should create exactly 1 object
      expect(objects).to.have.length(1);

      const calc = objects[0];

      // Check schema has a collection with a value field
      expectCollectionWithFields(channel, ['result']);

      // Value should be a number
      expect(calc.body.result).to.be.a('number');

      const result = calc.body.result as number;

      // Allow 0.01% tolerance for floating point
      const tolerance = EXPECTED_VALUE * 0.00001;
      expect(result).to.be.closeTo(EXPECTED_VALUE, tolerance);

    } finally {
      space.close();
    }
  },
};
