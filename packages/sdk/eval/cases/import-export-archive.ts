import { expect } from 'chai';
import type { TestCase } from '../types.js';
import { loadArchiveFixture } from '../helpers.js';

/**
 * Tests archive import/export with files.
 * Imports a zip archive containing JSON-LD and files, verifies structure,
 * exports back to archive, and compares sizes.
 */
export const testCase: TestCase = {
  description: 'Imports archive with files, verifies data, and round-trips correctly',

  async run(client) {
    // Import the archive
    const archive = loadArchiveFixture('rools-star');
    const space = await client.importArchive('EVAL: import-export-archive', archive);
    const channel = await space.openChannel('console');

    try {
      // Verify object count (4 objects: star + 3 planets)
      const objectIds = channel.getObjectIds();
      expect(objectIds).to.have.length(4);

      // Verify the star exists. Keys are in path-identity form (`<type>/<id>`).
      const star = await channel.getObject('star/XIQb6n');
      expect(star).to.exist;
      expect(star!.name).to.equal("Rool's Star");
      expect(star!.type).to.equal('star');
      // External URL should be preserved
      expect(star!.image_url).to.include('https://');

      // Verify a planet with a local file
      const enki = await channel.getObject('planet/rjP7pk');
      expect(enki).to.exist;
      expect(enki!.name).to.equal('Enki');
      expect(enki!.type).to.equal('planet');
      // Local file should have an image_url
      expect(enki!.image_url).to.be.a('string');
      expect((enki!.image_url as string).length).to.be.greaterThan(0);

      // Verify the gas giant
      const an = await channel.getObject('planet/1KIBtw');
      expect(an).to.exist;
      expect(an!.name).to.equal('An');
      expect(an!.type).to.equal('planet');

      // Verify reference structure — planets reference the star via `orbits`.
      expect(enki!.orbits).to.equal('star/XIQb6n', 'Enki should reference the star via orbits');

      // Verify the uploaded file is fetchable
      const enkiImageUrl = enki!.image_url as string;
      const response = await space.webdav.fetch(enkiImageUrl);
      const blob = await response.blob();
      expect(blob.size).to.be.greaterThan(10000); // ~70KB image
      expect(response.headers.get('content-type')).to.equal('image/png');

      // Export back to archive (exportArchive is on the space, not the channel)
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
