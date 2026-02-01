import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://docs.rool.dev',
  integrations: [
    starlight({
      title: 'Rool SDK',
      logo: {
        src: './src/assets/rool.svg',
        replacesTitle: true,
      },
      customCss: ['./src/styles/custom.css'],
      social: {
        github: 'https://github.com/rool-dev/rool-js',
      },
      sidebar: [
        {
          label: 'Documentation',
          items: [
            { label: 'SDK', link: '/' },
            { label: 'CLI', link: '/cli/' },
          ],
        },
      ],
    }),
  ],
});
