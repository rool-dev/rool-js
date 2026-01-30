import { expect } from 'chai';
import type { TestCase } from '../types.js';
import { expectLinkCount } from '../helpers.js';

const EXPECTED_VALUE = (Math.E + Math.PI) ** 4; // ≈ 1179.107099469
/**
 * Tests that the AI can compute accurately using the eval_code tool.
 */
export const testCase: TestCase = {
  description: 'Creates an object with the computed value of e^5',

  async run(space) {
    const { objects } = await space.prompt(`
      Create a new object with:
      - type: "calculation"
      - value: the computed result of (e+pi)^4
    `);

    // Should create exactly 1 object
    expect(objects).to.have.length(1);

    const calc = objects[0];

    // Check type
    expect(calc.type).to.equal('calculation');

    // Value should be a number
    expect(calc.value).to.be.a('number');

    const value = calc.value as number;

    // Allow 0.01% tolerance for floating point
    const tolerance = EXPECTED_VALUE * 0.00001;
    expect(value).to.be.closeTo(EXPECTED_VALUE, tolerance);

    expectLinkCount(space, 0);
  },
};
