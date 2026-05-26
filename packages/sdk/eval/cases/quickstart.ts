import { expect } from 'chai';
import type { TestCase } from '../types.js';

/**
 * Mirrors the README Quick Start example.
 * Creates a solar system with schema, placeholders, prompt, and findObjects.
 */
export const testCase: TestCase = {
  description: 'README Quick Start: solar system with schema, placeholders, prompt, and query',

  async run(client) {
    const space = await client.createSpace('EVAL: quickstart');
    const channel = await space.openChannel('console');

    try {
      const conversation = channel.conversation('quickstart-eval');

      // Define the schema
      await conversation.createCollection('body', [
        { name: 'name', type: { kind: 'string' } },
        { name: 'mass', type: { kind: 'string' } },
        { name: 'radius', type: { kind: 'string' } },
        { name: 'orbits', type: { kind: 'maybe', inner: { kind: 'ref' } } },
      ]);

      // Create objects with AI-generated content using {{placeholders}}
      const { object: sun } = await conversation.createObject('body', {
        name: 'Sun',
        mass: '{{mass in Earth masses}}',
        radius: '{{radius in km}}',
      }, { basename: 'sun' });

      expect(sun.body.name).to.equal('Sun');
      expect(sun.body.mass).to.exist;
      expect(sun.body.radius).to.exist;
      expect(sun.body.orbits).to.not.exist;

      const { object: earth } = await conversation.createObject('body', {
        name: 'Earth',
        mass: '{{mass in Earth masses}}',
        radius: '{{radius in km}}',
        orbits: sun.location,
      }, { basename: 'earth' });

      expect(earth.body.name).to.equal('Earth');
      expect(earth.body.orbits).to.equal(sun.location);

      // Use prompt to add remaining planets
      const { objects } = await conversation.prompt(
        'Add the other planets in our solar system, each referencing the Sun'
      );

      expect(objects.length).to.equal(7, 'Should create 7 more planets');

      // Every prompted planet should reference the sun
      for (const obj of objects) {
        expect(obj.body.orbits, `${obj.body.name} should orbit the Sun`).to.equal(sun.location);
      }

      // Query with natural language
      const { objects: innerPlanets } = await conversation.findObjects({
        prompt: 'planets closer to the sun than Earth'
      });

      expect(innerPlanets.length).to.be.at.least(2, 'Should find at least 2 inner planets');
      const names = innerPlanets.map(p => String(p.body.name).toLowerCase());
      const hasInner = names.some(n => n === 'mercury' || n === 'venus');
      expect(hasInner, `Inner planets should include Mercury or Venus, got: ${names.join(', ')}`).to.be.true;

    } finally {
      space.close();
    }
  },
};
