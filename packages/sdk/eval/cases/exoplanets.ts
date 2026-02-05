import { expect } from 'chai';
import type { TestCase } from '../types.js';
import { expectLinkCount } from '../helpers.js';

const PLANET_NAMES = ['draugr', 'poltergeist', 'phobetor'] as const;

const isTopicData = (data: Record<string, unknown>): boolean =>
  data.type === 'topic' &&
  typeof data.headline === 'string' &&
  (data.headline.includes('1257') || data.headline.toLowerCase().includes('pulsar'));

const isPlanetData = (data: Record<string, unknown>, planet: string): boolean =>
  data.type === 'markdown' &&
  typeof data.headline === 'string' &&
  data.headline.toLowerCase().includes(planet);

/**
 * Tests knowledge graph creation with web research.
 * Validates hierarchy creation and link structure.
 */
export const testCase: TestCase = {
  description: 'Creates PSR B1257+12 exoplanet hierarchy with links',

  async run(client) {
    const space = await client.createSpace('EVAL: exoplanets');

    try {
      const { objects } = await space.prompt(`
        Create a knowledge graph about the exoplanets orbiting PSR B1257+12.

        Start with a topic node for the pulsar system, then add a markdown node for each exoplanet with its popular name in the headline field and a brief description in the text field. Connect the topic to each planet with expand edges.

        Each object should have:
        - type: "markdown" | "topic"
        - headline: string
        - text: string
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

      // Verify link structure
      const data = space.getData();
      const topicId = Object.keys(data.objects).find(id => isTopicData(data.objects[id].data as Record<string, unknown>));
      expect(topicId, 'Topic should exist in space').to.exist;

      const topicLinks = data.objects[topicId!].links.expand ?? [];
      const planetIds = PLANET_NAMES.map(planet =>
        Object.keys(data.objects).find(id => isPlanetData(data.objects[id].data as Record<string, unknown>, planet))
      );

      for (const planetId of planetIds) {
        expect(planetId, 'Planet should exist').to.exist;
        expect(topicLinks.includes(planetId!), `Topic should link to planet ${planetId}`).to.be.true;
      }

      expectLinkCount(space, 3);
    } finally {
      space.close();
    }
  },
};
