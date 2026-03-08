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

    try {
      const { objects } = await space.prompt(`
        Create a new object with:
        - type: "calculation"
        - value: the computed result of (e+pi)^4
      `);

      // Should create exactly 1 object
      expect(objects).to.have.length(1);

      const calc = objects[0];

      // Check schema has a collection with a value field
      expectCollectionWithFields(space, ['value']);

      // Value should be a number
      expect(calc.value).to.be.a('number');

      const value = calc.value as number;

      // Allow 0.01% tolerance for floating point
      const tolerance = EXPECTED_VALUE * 0.00001;
      expect(value).to.be.closeTo(EXPECTED_VALUE, tolerance);

    } finally {
      space.close();
    }
  },
};
