import { expect } from 'chai';
import type { TestCase } from '../types.js';
import { collectionOf, createCollectionWithRetry, listObjectPaths, objectPath } from '../helpers.js';

/**
 * Tests current object APIs plus AI prompt-based enrichment.
 * The AI must look up the CVR number for a Danish company.
 */
export const testCase: TestCase = {
  description: 'Looks up CVR number for a Danish company using prompt enrichment',

  async run(client) {
    const space = await client.createSpace('EVAL: company-lookup');
    const channel = await space.openChannel('console');

    try {
      const conversation = channel.conversation('company-lookup-eval');
      await createCollectionWithRetry(conversation, 'company', [
        { name: 'name', type: { kind: 'string' } },
        { name: 'cvr', type: { kind: 'string' } },
      ]);

      const companyPath = objectPath('company', 'aves');
      await conversation.putObject(companyPath, {
        name: 'Aves ApS',
        cvr: '',
      });

      await conversation.prompt(
        'Look up the CVR number for the attached Danish company and fill the cvr field. Modify only the attached object.',
        { attachments: [companyPath] },
      );

      const object = await channel.getObject(companyPath);
      expect(object).to.exist;
      expect(collectionOf(object!)).to.equal('company');
      expect(object!.body.name).to.equal('Aves ApS');

      // Verify CVR was filled in correctly.
      expect(object!.body.cvr).to.be.a('string');
      const cvr = String(object!.body.cvr).replace(/\s/g, ''); // Remove any spaces.
      expect(cvr).to.equal('29530335', 'CVR number should be 29530335');

      // Verify no extra objects were created.
      expect(await listObjectPaths(space)).to.deep.equal([companyPath]);
    } finally {
      space.close();
    }
  },
};
