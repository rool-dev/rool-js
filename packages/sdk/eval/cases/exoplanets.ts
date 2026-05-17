import { expect } from 'chai';
import type { TestCase } from '../types.js';


const PLANET_NAMES = ['draugr', 'poltergeist', 'phobetor'] as const;


/**
 * Tests knowledge graph creation with web research.
 * Validates hierarchy creation and reference structure.
 */
export const testCase: TestCase = {
  description: 'Creates PSR B1257+12 exoplanet hierarchy with references',

  async run(client) {
    const space = await client.createSpace('EVAL: exoplanets');
    const channel = await space.openChannel('console');

    try {
      const conversation = channel.conversation('exoplanets-eval');
      const { objects } = await conversation.prompt(`
Create a knowledge graph with collections named star and planet. The planet collection should have an "orbits" field referencing the star
Then add the star PSR B1257+12 and the exoplanets orbiting it. Set the name field to the popular name for each of the exoplanets
      `);

      // Should create 4 objects: 1 topic + 3 planets
      expect(objects).to.have.length(4);

      // Should have a star
      const star = objects.find(obj => obj.type == "star");
      expect(star, 'Should have a star object node').to.exist;

      // Should have all three planets and should reference the star
      const planets = objects.filter(obj => obj.type === 'planet');
      expect(planets, 'Should have three planet objects').to.have.length(3);

      for (const name of PLANET_NAMES) {
        const planet = planets.find(p => typeof p.name === 'string' && p.name.toLowerCase().includes(name));
        expect(planet, `Should have planet "${name}"`).to.exist;
        expect(planet!.orbits, `Planet "${name}" should reference the star`).to.equal(star!.id);
      }

    } finally {
      space.close();
    }
  },
};
