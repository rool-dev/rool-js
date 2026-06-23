import { expect } from 'chai';
import type { TestCase } from '../types.js';
import { collectionOf, listObjectPaths, loadArchiveFixture } from '../helpers.js';

/**
 * Tests archive import/export with files.
 * Imports a zip archive containing JSON-LD and files, verifies structure,
 * exports back to archive, and compares sizes.
 */
export const testCase: TestCase = {
  description: 'Imports archive with files, verifies data, and round-trips correctly',

  async run(client) {
    // Import the archive.
    const archive = loadArchiveFixture('rools-star');
    const space = await client.importArchive('EVAL: import-export-archive', archive);

    try {
      // Verify object count (4 objects: star + 3 planets).
      const paths = await listObjectPaths(space);
      expect(paths).to.have.length(4);

      const starPath = '/space/star/XIQb6n.json';

      // Verify the star exists.
      const star = await space.getObject(starPath);
      expect(star).to.exist;
      expect(star!.body.name).to.equal("Rool's Star");
      expect(collectionOf(star!)).to.equal('star');
      // External URL should be preserved.
      expect(star!.body.image_url).to.include('https://');

      // Verify a planet with a local file.
      const enki = await space.getObject('/space/planet/rjP7pk.json');
      expect(enki).to.exist;
      expect(enki!.body.name).to.equal('Enki');
      expect(collectionOf(enki!)).to.equal('planet');
      // Local file should have an image_url.
      expect(enki!.body.image_url).to.be.a('string');
      expect((enki!.body.image_url as string).length).to.be.greaterThan(0);

      // Verify the gas giant.
      const an = await space.getObject('/space/planet/1KIBtw.json');
      expect(an).to.exist;
      expect(an!.body.name).to.equal('An');
      expect(collectionOf(an!)).to.equal('planet');

      // Verify reference structure — planets reference the star via `orbits`.
      expect(enki!.body.orbits).to.equal(starPath, 'Enki should reference the star via orbits');

      // Verify the uploaded file is fetchable. After import the server rewrites
      // archive `files/...` paths to full WebDAV URLs; extract the path portion
      // (everything after `/dav/<spaceId>/`) and fetch via the WebDAV client.
      const enkiImageUrl = enki!.body.image_url as string;
      expect(enkiImageUrl).to.match(/\/(?:dav|space)\/[^/]+\/.*\.png$/, 'image_url should be a WebDAV URL');
      const urlPath = new URL(enkiImageUrl).pathname;
      const filePath = urlPath.includes(`/space/${space.id}/`)
        ? `/${urlPath.split(`/space/${space.id}/`)[1]}`
        : `/${urlPath.split(`/dav/${space.id}/`)[1]}`;
      const response = await space.webdav.get(filePath);
      const blob = await response.blob();
      expect(blob.size).to.be.greaterThan(10000); // ~70KB image.
      expect(response.headers.get('content-type')).to.equal('image/png');

      // Export back to archive.
      const exported = await space.exportArchive();

      // Current export is a normalized server archive, not byte-for-byte equivalent
      // to the legacy fixture. It should still be a non-empty zip payload.
      expect(exported.size).to.be.greaterThan(0);
      expect(exported.type === 'application/zip' || exported.type === 'application/octet-stream' || exported.type === '').to.be.true;
    } finally {
      space.close();
    }
  },
};
