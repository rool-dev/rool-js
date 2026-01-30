import { expect } from 'chai';
import type { TestCase } from '../types.js';
import { expectLinkCount } from '../helpers.js';

const isYouTubeUrl = (s: unknown): boolean =>
  typeof s === 'string' && (s.includes('youtube.com') || s.includes('youtu.be'));

// Known video IDs for Jake Shimabukuro's "While My Guitar Gently Weeps"
const KNOWN_VIDEO_IDS = ['puSkP3uym5k', 'qw6yl_l2yxa', '0gaWuadgL3g'];

/**
 * Tests video search and URL extraction.
 * Validates that the AI can find a specific YouTube video.
 */
export const testCase: TestCase = {
  description: 'Creates a video node with correct YouTube URL via research',

  async run(space) {
    const { objects } = await space.prompt(`
      Create a node with ukulele performance of "While My Guitar Gently Weeps" by Jake Shimabukuro.

      The node should have:
      - type: "video"
      - headline: A descriptive title
      - text: A brief description of the performance and why it's notable
      - videoUrl: The YouTube link to the video
    `);

    expect(objects).to.have.length(1);

    const video = objects[0];

    expect(video.headline).to.be.a('string');
    expect((video.headline as string).length).to.be.greaterThan(0);
    expect(video.text).to.be.a('string');
    expect((video.text as string).length).to.be.greaterThan(20);

    expect(isYouTubeUrl(video.videoUrl), 'Should be a YouTube URL').to.be.true;

    const url = video.videoUrl as string;
    const hasCorrectVideo = KNOWN_VIDEO_IDS.some(id => url.toLowerCase().includes(id.toLowerCase()));
    expect(hasCorrectVideo, `Video URL should contain one of: ${KNOWN_VIDEO_IDS.join(', ')}`).to.be.true;

    expectLinkCount(space, 0);
  },
};
