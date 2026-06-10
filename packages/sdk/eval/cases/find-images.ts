import { expect } from 'chai';
import type { TestCase } from '../types.js';
import { listObjectPaths, loadArchiveFixture, parseJsonMessage } from '../helpers.js';

// Expected ImageObject nodes in the electrical fixture (after legacy import,
// bare basenames migrate into the ImageObject collection).
const EXPECTED_IMAGE_PATHS = new Set([
  '/space/ImageObject/2TvtH2.json',
  '/space/ImageObject/86Trm4.json',
]);

/**
 * Tests image lookup using a read-only structured prompt.
 */
export const testCase: TestCase = {
  description: 'Finds image objects',

  async run(client) {
    // Import the fixture.
    const archive = loadArchiveFixture('electrical-new');
    const space = await client.importArchive('EVAL: find-images', archive);
    const channel = await space.openChannel('console');

    try {
      const conversation = channel.conversation('find-images-eval');

      // Capture initial state.
      const initialPaths = await listObjectPaths(space);

      const { message } = await conversation.prompt(
        'Find all existing image objects. Return exactly their object paths.',
        {
          readOnly: true,
          responseSchema: {
            type: 'object',
            properties: { paths: { type: 'array', items: { type: 'string' } } },
            required: ['paths'],
            additionalProperties: false,
          },
        },
      );
      const { paths } = parseJsonMessage<{ paths: string[] }>(message);
      const { objects } = await channel.getObjects(paths);

      // Should find exactly the 2 ImageObject nodes.
      expect(objects.length).to.equal(2, 'Should find exactly 2 image objects');

      // Verify we found the expected nodes.
      const foundPaths = new Set(objects.map(o => o.path));
      expect(foundPaths).to.deep.equal(EXPECTED_IMAGE_PATHS, 'Should find the expected image nodes');

      // Verify all found objects have contentUrl.
      for (const obj of objects) {
        expect(obj.body.contentUrl).to.be.a('string');
      }

      // The 2TvtH2 image was stored as a legacy `media/<uuid>.png` reference
      // inside the archive; on import the server must upload the file into
      // the new space's WebDAV storage and rewrite the body field to point at
      // the new location. Verify both happened.
      const localImage = objects.find(o => o.path === '/space/ImageObject/2TvtH2.json');
      expect(localImage, 'Should find the 2TvtH2 ImageObject').to.exist;
      const localContentUrl = localImage!.body.contentUrl as string;
      expect(localContentUrl.startsWith('media/'), `contentUrl should be rewritten away from media/ form, was ${localContentUrl}`).to.be.false;

      // The other image's contentUrl is an external https URL and should be preserved.
      const externalImage = objects.find(o => o.path === '/space/ImageObject/86Trm4.json');
      expect(externalImage, 'Should find the 86Trm4 ImageObject').to.exist;
      expect((externalImage!.body.contentUrl as string).startsWith('https://')).to.be.true;

      // Fetch the migrated file and verify it's the imported PNG.
      const url = new URL(localContentUrl);
      const filePath = url.pathname.split('/').slice(3).map(decodeURIComponent).join('/');
      const response = await space.webdav.get(filePath);
      const blob = await response.blob();
      expect(blob.size).to.be.greaterThan(10000, 'Migrated PNG should be non-trivial in size');
      expect(response.headers.get('content-type')).to.equal('image/png');

      // Verify space was not modified.
      const finalPaths = await listObjectPaths(space);
      expect(finalPaths.sort()).to.deep.equal(initialPaths.sort());
    } finally {
      space.close();
    }
  },
};
