import { expect } from 'chai';
import type { TestCase } from '../types.js';
import { collectionOf, createCollectionWithRetry, objectPath, parseJsonMessage } from '../helpers.js';

/**
 * Exercises the current SDK shape: create schema, putObject, prompt, and read-only structured prompt query.
 */
export const testCase: TestCase = {
  description: 'Solar system with schema, putObject, prompt, and structured query',

  async run(client) {
    const space = await client.createSpace('EVAL: quickstart');

    try {
      const conversation = space.conversation('quickstart-eval');

      // Define the schema.
      await createCollectionWithRetry(conversation, 'body', [
        { name: 'name', type: { kind: 'string' } },
        { name: 'mass', type: { kind: 'string' } },
        { name: 'radius', type: { kind: 'string' } },
        { name: 'orbits', type: { kind: 'maybe', inner: { kind: 'ref' } } },
      ]);

      // Create known seed objects at explicit paths.
      const sunPath = objectPath('body', 'sun');
      const { object: sun } = await conversation.putObject(sunPath, {
        name: 'Sun',
        mass: '1 solar mass',
        radius: '696,340 km',
      });

      expect(sun.path).to.equal(sunPath);
      expect(sun.body.name).to.equal('Sun');
      expect(sun.body.orbits).to.not.exist;

      const earthPath = objectPath('body', 'earth');
      const { object: earth } = await conversation.putObject(earthPath, {
        name: 'Earth',
        mass: '1 Earth mass',
        radius: '6,371 km',
        orbits: sun.path,
      });

      expect(earth.body.name).to.equal('Earth');
      expect(earth.body.orbits).to.equal(sun.path);

      // Use prompt to add remaining planets.
      const { objects } = await conversation.prompt(
        'Add the other seven planets in our solar system to the existing body collection. Each should reference the Sun path in its orbits field.',
        { attachments: [sun.path, earth.path] },
      );

      const newPlanets = objects.filter(o => collectionOf(o) === 'body' && o.path !== sun.path && o.path !== earth.path);
      expect(newPlanets.length).to.equal(7, 'Should create 7 more planets');

      for (const obj of newPlanets) {
        expect(obj.body.orbits, `${obj.body.name} should orbit the Sun`).to.equal(sun.path);
      }

      // Query with a read-only structured prompt.
      const { message } = await conversation.prompt(
        'Which existing planets are closer to the Sun than Earth? Return their object paths only.',
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

      const result = parseJsonMessage<{ paths: string[] }>(message);
      expect(result.paths.length).to.be.at.least(2, 'Should find at least 2 inner planets');
      const { objects: innerPlanets } = await space.getObjects(result.paths);
      const names = innerPlanets.map(p => String(p.body.name).toLowerCase());
      const hasInner = names.some(n => n === 'mercury' || n === 'venus');
      expect(hasInner, `Inner planets should include Mercury or Venus, got: ${names.join(', ')}`).to.be.true;
    } finally {
      space.close();
    }
  },
};
