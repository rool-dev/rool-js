import { expect } from 'chai';
import type { TestCase } from '../types.js';
import { expectLinkCount } from '../helpers.js';

/**
 * Tests createObject with AI placeholder to research company information.
 * The AI must look up the CVR number for a Danish company.
 */
export const testCase: TestCase = {
  description: 'Looks up CVR number for a Danish company using placeholder',

  async run(client) {
    const space = await client.createSpace('EVAL: company-lookup');

    try {
      // Create object with known company name and placeholder for CVR
      const { object } = await space.createObject({
        data: {
          type: 'company',
          name: 'Aves ApS',
          cvr: '{{CVR number for this Danish company}}',
        },
      });

      // Verify the object was created
      expect(object.type).to.equal('company');
      expect(object.name).to.equal('Aves ApS');

      // Verify CVR was filled in correctly
      expect(object.cvr).to.be.a('string');
      const cvr = String(object.cvr).replace(/\s/g, ''); // Remove any spaces
      expect(cvr).to.equal('29530335', 'CVR number should be 29530335');

      // Verify no extra objects or links were created
      expect(space.getObjectIds()).to.have.length(1);
      expectLinkCount(space, 0);
    } finally {
      space.close();
    }
  },
};
