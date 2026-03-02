import { expect } from 'chai';
import type { TestCase } from '../types.js';
import { loadArchiveFixture } from '../helpers.js';

/**
 * Tests archive import/export with media files.
 * Imports a zip archive containing JSON-LD and media, verifies structure,
 * exports back to archive, and compares sizes.
 */
export const testCase: TestCase = {
  description: 'Imports archive with media, verifies data, and round-trips correctly',

  async run(client) {
    // Import the archive
    const archive = loadArchiveFixture('rools-star');
    const space = await client.importArchive('EVAL: import-export-archive', archive);

    try {
      // Verify object count (4 objects: star + 3 planets)
      const objectIds = space.getObjectIds();
      expect(objectIds).to.have.length(4);

      // Verify the star exists
      const star = await space.getObject('XIQb6n');
      expect(star).to.exist;
      expect(star!.name).to.equal("Rool's Star");
      expect(star!.type).to.equal('star');
      // External URL should be preserved
      expect(star!.image_url).to.include('https://');

      // Verify a planet with local media
      const enki = await space.getObject('rjP7pk');
      expect(enki).to.exist;
      expect(enki!.name).to.equal('Enki');
      expect(enki!.type).to.equal('planet');
      // Local media should have an image_url (fetchMedia will resolve it)
      expect(enki!.image_url).to.be.a('string');
      expect((enki!.image_url as string).length).to.be.greaterThan(0);

      // Verify the gas giant
      const an = await space.getObject('1KIBtw');
      expect(an).to.exist;
      expect(an!.name).to.equal('An');
      expect(an!.type).to.equal('planet');

      // Verify reference structure — planets reference the star via data fields
      // The orbits relationship is stored as a data field containing the star's ID
      const enkiData = JSON.stringify(enki);
      expect(enkiData).to.include('XIQb6n', 'Enki should reference the star ID in its data');

      // Verify the uploaded media is fetchable
      const enkiImageUrl = enki!.image_url as string;
      const response = await space.fetchMedia(enkiImageUrl);
      const blob = await response.blob();
      expect(blob.size).to.be.greaterThan(10000); // ~70KB image
      expect(response.contentType).to.equal('image/png');

      // Export back to archive
      const exported = await space.exportArchive();

      // Archive sizes should be similar (within 10% due to compression differences)
      const originalSize = archive.size;
      const exportedSize = exported.size;
      const ratio = exportedSize / originalSize;
      expect(ratio, `Export size ratio ${ratio} should be close to 1`).to.be.within(0.99, 1.01);
    } finally {
      space.close();
    }
  },
};
