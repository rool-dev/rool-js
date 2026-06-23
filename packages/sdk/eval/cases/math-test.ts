import { expect } from 'chai';
import type { TestCase } from '../types.js';
import { collectionOf, createCollectionWithRetry } from '../helpers.js';

const EXPECTED_VALUE = (Math.E + Math.PI) ** 4; // ≈ 1179.107099469

/**
 * Tests that the AI can compute accurately using the eval_code tool.
 */
export const testCase: TestCase = {
  description: 'Creates an object with the computed value of (e+pi)^4',

  async run(client) {
    const space = await client.createSpace('EVAL: math-test');

    try {
      const conversation = space.conversation('math-test-eval');
      await createCollectionWithRetry(conversation, 'calculation', [
        { name: 'formula', type: { kind: 'string' } },
        { name: 'result', type: { kind: 'number' } },
      ]);

      const { objects } = await conversation.prompt(`Create exactly one object in the existing calculation collection with fields named 'formula' and 'result' containing the value of (e+pi)^4`);

      expect(objects).to.have.length(1);
      const calc = objects[0];
      expect(collectionOf(calc)).to.equal('calculation');

      // Value should be a number.
      expect(calc.body.result).to.be.a('number');

      const result = calc.body.result as number;

      // Allow 0.01% tolerance for floating point.
      const tolerance = EXPECTED_VALUE * 0.00001;
      expect(result).to.be.closeTo(EXPECTED_VALUE, tolerance);
    } finally {
      space.close();
    }
  },
};
