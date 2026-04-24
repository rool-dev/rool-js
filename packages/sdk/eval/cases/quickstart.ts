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
      // Define the schema
      await channel.createCollection('body', [
        { name: 'name', type: { kind: 'string' } },
        { name: 'mass', type: { kind: 'string' } },
        { name: 'radius', type: { kind: 'string' } },
        { name: 'orbits', type: { kind: 'maybe', inner: { kind: 'ref' } } },
      ]);

      // Create objects with AI-generated content using {{placeholders}}
      const { object: sun } = await channel.createObject({
        data: {
          type: 'body',
          name: 'Sun',
          mass: '{{mass in solar masses}}',
          radius: '{{radius in km}}'
        }
      });

      expect(sun.name).to.equal('Sun');
      expect(sun.mass).to.exist;
      expect(sun.radius).to.exist;
      expect(sun.orbits).to.not.exist;

      const { object: earth } = await channel.createObject({
        data: {
          type: 'body',
          name: 'Earth',
          mass: '{{mass in Earth masses}}',
          radius: '{{radius in km}}',
          orbits: sun.id
        }
      });

      expect(earth.name).to.equal('Earth');
      expect(earth.orbits).to.equal(sun.id);

      // Use prompt to add remaining planets
      const { objects } = await channel.prompt(
        'Add the other planets in our solar system, each referencing the Sun'
      );

      expect(objects.length).to.equal(7, 'Should create 7 more planets');

      // Every prompted planet should reference the sun
      for (const obj of objects) {
        expect(obj.orbits, `${obj.name} should orbit the Sun`).to.equal(sun.id);
      }

      // Query with natural language
      const { objects: innerPlanets } = await channel.findObjects({
        prompt: 'planets closer to the sun than Earth'
      });

      expect(innerPlanets.length).to.be.at.least(2, 'Should find at least 2 inner planets');
      const names = innerPlanets.map(p => String(p.name).toLowerCase());
      const hasInner = names.some(n => n === 'mercury' || n === 'venus');
      expect(hasInner, `Inner planets should include Mercury or Venus, got: ${names.join(', ')}`).to.be.true;

    } finally {
      channel.close();
    }
  },
};
