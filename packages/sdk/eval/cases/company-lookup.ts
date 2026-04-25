import { expect } from 'chai';
import type { TestCase } from '../types.js';


/**
 * Tests createObject with AI placeholder to research company information.
 * The AI must look up the CVR number for a Danish company.
 */
export const testCase: TestCase = {
  description: 'Looks up CVR number for a Danish company using placeholder',

  async run(client) {
    const space = await client.createSpace('EVAL: company-lookup');
    const channel = await space.openChannel('console');

    try {
      await channel.createCollection('company', [
        { name: 'name', type: { kind: 'string' } },
        { name: 'cvr', type: { kind: 'string' } },
      ]);

      // Create object with known company name and placeholder for CVR
      const { object } = await channel.createObject({
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

      // Verify no extra objects were created
      expect(channel.getObjectIds()).to.have.length(1);
    } finally {
      space.close();
    }
  },
};
