import { expect } from 'chai';
import type { TestCase } from '../types.js';


const PLANET_NAMES = ['draugr', 'poltergeist', 'phobetor'] as const;

const isTopicData = (data: Record<string, unknown>): boolean =>
  data.type === 'star' &&
  typeof data.headline === 'string' &&
  (data.headline.includes('1257') || data.headline.toLowerCase().includes('pulsar'));

const isPlanetData = (data: Record<string, unknown>, planet: string): boolean =>
  data.type === 'planet' &&
  typeof data.headline === 'string' &&
  data.headline.toLowerCase().includes(planet);

/**
 * Tests knowledge graph creation with web research.
 * Validates hierarchy creation and reference structure.
 */
export const testCase: TestCase = {
  description: 'Creates PSR B1257+12 exoplanet hierarchy with references',

  async run(client) {
    const space = await client.createSpace('EVAL: exoplanets');

    try {
      const { objects } = await space.prompt(`
        Create a knowledge graph about the exoplanets orbiting PSR B1257+12.

        Start with a node for the pulsar star, then add a 'planet' node for each exoplanet with its popular name in the headline field and a brief description in the text field. Each planet should have an "orbits" field referencing the topic node's ID.

        Each object should have:
        - type: "planet" | "star"
        - headline: string
        - text: string
        - orbits: <id> # optional 
      `);

      // Should create 4 objects: 1 topic + 3 planets
      expect(objects).to.have.length(4);

      // Should have a pulsar topic
      const topic = objects.find(obj => isTopicData(obj as Record<string, unknown>));
      expect(topic, 'Should have a pulsar topic node').to.exist;

      // Should have all three planets
      for (const planet of PLANET_NAMES) {
        const planetObj = objects.find(obj => isPlanetData(obj as Record<string, unknown>, planet));
        expect(planetObj, `Should have planet: ${planet}`).to.exist;
        expect((planetObj!.text as string).length).to.be.at.least(20, `${planet} should have description`);
      }

      // Verify reference structure — each planet should reference the topic via "orbits"
      const topicId = topic!.id;

      for (const planet of PLANET_NAMES) {
        const planetObj = objects.find(obj => isPlanetData(obj as Record<string, unknown>, planet));
        expect(planetObj!.orbits, `${planet} should have orbits field`).to.equal(topicId);
      }

    } finally {
      space.close();
    }
  },
};
