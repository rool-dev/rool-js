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
      const locations = channel.getObjectLocations();
      expect(locations).to.have.length(4);

      const starLocation = '/space/star/XIQb6n.json';

      // Verify the star exists.
      const star = await channel.getObject(starLocation);
      expect(star).to.exist;
      expect(star!.body.name).to.equal("Rool's Star");
      expect(star!.collection).to.equal('star');
      // External URL should be preserved
      expect(star!.body.image_url).to.include('https://');

      // Verify a planet with a local file
      const enki = await channel.getObject('planet/rjP7pk');
      expect(enki).to.exist;
      expect(enki!.body.name).to.equal('Enki');
      expect(enki!.collection).to.equal('planet');
      // Local file should have an image_url
      expect(enki!.body.image_url).to.be.a('string');
      expect((enki!.body.image_url as string).length).to.be.greaterThan(0);

      // Verify the gas giant
      const an = await channel.getObject('planet/1KIBtw');
      expect(an).to.exist;
      expect(an!.body.name).to.equal('An');
      expect(an!.collection).to.equal('planet');

      // Verify reference structure — planets reference the star via `orbits`.
      expect(enki!.body.orbits).to.equal(starLocation, 'Enki should reference the star via orbits');

      // Verify the uploaded file is fetchable. After import the server rewrites
      // archive `files/...` paths to full WebDAV URLs; extract the path portion
      // (everything after `/dav/<spaceId>/`) and fetch via the WebDAV client.
      const enkiImageUrl = enki!.body.image_url as string;
      expect(enkiImageUrl).to.match(/\/dav\/[^/]+\/[^/]+\.png$/, 'image_url should be a WebDAV URL');
      const filePath = new URL(enkiImageUrl).pathname.split('/').slice(3).map(decodeURIComponent).join('/');
      const response = await space.webdav.get(filePath);
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
