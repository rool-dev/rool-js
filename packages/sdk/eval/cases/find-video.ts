import { expect } from 'chai';
import type { TestCase } from '../types.js';


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

  async run(client) {
    const space = await client.createSpace('EVAL: find-video');
    const channel = await space.openChannel('console');

    try {
      const conversation = channel.conversation('find-video-eval');
      const { objects } = await conversation.prompt(`Create a video object with the ukulele performance of "While My Guitar Gently Weeps" by Jake Shimabukuro.`);

      expect(objects).to.have.length(1);

      const video = objects[0];

      const name = video.body.name ?? video.body.headline ?? video.body.title;
      expect(name).to.be.a('string');
      expect((name as string).length).to.be.greaterThan(0);
      const description = video.body.description ?? video.body.text;
      expect(description).to.be.a('string');
      expect((description as string).length).to.be.greaterThan(20);

      expect(isYouTubeUrl(video.body.url), 'Should be a YouTube URL').to.be.true;

      const url = video.body.url as string;
      const hasCorrectVideo = KNOWN_VIDEO_IDS.some(id => url.toLowerCase().includes(id.toLowerCase()));
      expect(hasCorrectVideo, `Video URL should contain one of: ${KNOWN_VIDEO_IDS.join(', ')}`).to.be.true;

    } finally {
      space.close();
    }
  },
};
