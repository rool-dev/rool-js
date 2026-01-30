import { expect } from 'chai';
import type { TestCase } from '../types.js';
import { expectLinkCount, loadFixture } from '../helpers.js';

const fixture = loadFixture('electrical');

/**
 * Tests import/export with a predefined JSON-LD fixture.
 * Imports the electrical systems dataset, verifies structure, exports, and compares.
 */
export const testCase: TestCase = {
  description: 'Imports JSON-LD fixture, verifies data, and round-trips correctly',

  async run(space) {
    // Import the fixture
    await space.import(fixture);

    // Verify object count (9 objects in electrical.jsonld)
    const objectIds = space.getObjectIds();
    expect(objectIds).to.have.length(9);

    // Verify specific objects exist with correct data
    const rootTopic = await space.getObject('lcLido');
    expect(rootTopic!.type).to.equal('topic');
    expect(rootTopic!.headline).to.equal('Sailboat electrical systems');
    expect(rootTopic!.emoji).to.equal('⚡');

    const energyAudit = await space.getObject('752gMr');
    expect(energyAudit!.type).to.equal('markdown');
    expect(energyAudit!.headline).to.equal('Energy Audit: Calculate Power Consumption');
    expect(energyAudit!.text).to.include('**Amp-Hours (Ah)**');

    const imageSearch = await space.getObject('2TvtH2');
    expect(imageSearch!.type).to.equal('image-search');
    expect(imageSearch!.imageUrl).to.be.a('string');
    expect(imageSearch!.imageUrl).to.include('https://');

    // Verify link structure
    // lcLido -> expand -> [86Trm4, 2TvtH2, 752gMr, MZpMsZ]
    const lcLidoChildren = await space.getChildren('lcLido', 'expand');
    expect(lcLidoChildren).to.have.length(4);
    const lcLidoChildIds = lcLidoChildren.map(c => c.id);
    expect(lcLidoChildIds).to.include('86Trm4');
    expect(lcLidoChildIds).to.include('2TvtH2');
    expect(lcLidoChildIds).to.include('752gMr');
    expect(lcLidoChildIds).to.include('MZpMsZ');

    // MuOAek -> expand -> [P7Of9G, vpqh0x, tHNaGg]
    const muoaekChildren = await space.getChildren('MuOAek', 'expand');
    expect(muoaekChildren).to.have.length(3);

    // 752gMr -> expand -> [MuOAek]
    const auditChildren = await space.getChildren('752gMr', 'expand');
    expect(auditChildren).to.have.length(1);
    expect(auditChildren[0].id).to.equal('MuOAek');

    // Total links: lcLido(4) + MuOAek(3) + 752gMr(1) = 8
    expectLinkCount(space, 8);

    // Export and verify round-trip
    const exported = space.export();

    expect(exported['@context']).to.deep.equal({
      '@vocab': 'https://rool.dev/schema/',
      'id': '@id',
    });
    expect(exported['@graph']).to.have.length(9);

    // Normalize for comparison: sort graphs and relation arrays
    const normalize = (doc: typeof exported) => ({
      ...doc,
      '@graph': [...doc['@graph']]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(node => {
          const sorted: Record<string, unknown> = {};
          for (const key of Object.keys(node).sort()) {
            const val = node[key];
            if (Array.isArray(val) && val.every(v => typeof v === 'string')) {
              sorted[key] = [...val].sort();
            } else {
              sorted[key] = val;
            }
          }
          return sorted;
        }),
    });

    const normalizedFixture = normalize(fixture as typeof exported);
    const normalizedExport = normalize(exported);

    expect(normalizedExport).to.deep.equal(
      normalizedFixture,
      'Round-trip export should match original fixture'
    );
  },
};
