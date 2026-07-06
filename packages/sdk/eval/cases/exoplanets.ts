import { expect } from 'chai';
import type { TestCase } from '../types.js';
import { collectionOf, createCollectionWithRetry } from '../helpers.js';

const PLANET_NAMES = ['draugr', 'poltergeist', 'phobetor'] as const;

/**
 * Tests knowledge graph creation with web research.
 * Validates hierarchy creation and reference structure.
 */
export const testCase: TestCase = {
  description: 'Creates PSR B1257+12 exoplanet hierarchy with references',

  async run(client) {
    const space = await client.createSpace('EVAL: exoplanets');

    try {
      const conversation = space.conversation('exoplanets-eval');
      await createCollectionWithRetry(space, 'star', [
        { name: 'name', type: { kind: 'string' } },
      ]);
      await createCollectionWithRetry(space, 'planet', [
        { name: 'name', type: { kind: 'string' } },
        { name: 'orbits', type: { kind: 'ref' } },
      ]);

      const { objects } = await conversation.prompt(`Create objects using the existing star and planet collections.
Add the star PSR B1257+12 and the three confirmed exoplanets orbiting it. Set the name field to the popular name for each exoplanet. Each planet's orbits field must be the star object's path.`);

      // Should create 4 objects: 1 star + 3 planets.
      expect(objects).to.have.length(4);

      const star = objects.find(obj => collectionOf(obj) === 'star');
      expect(star, 'Should have a star object').to.exist;

      const planets = objects.filter(obj => collectionOf(obj) === 'planet');
      expect(planets, 'Should have three planet objects').to.have.length(3);

      for (const name of PLANET_NAMES) {
        const planet = planets.find(p => typeof p.body.name === 'string' && (p.body.name as string).toLowerCase().includes(name));
        expect(planet, `Should have planet "${name}"`).to.exist;
        expect(planet!.body.orbits, `Planet "${name}" should reference the star`).to.equal(star!.path);
      }
    } finally {
      space.close();
    }
  },
};
