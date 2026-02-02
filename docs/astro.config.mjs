import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://docs.rool.dev',
  integrations: [
    starlight({
      title: 'Rool',
      logo: {
        src: './src/assets/rool.svg',
        replacesTitle: true,
      },
      customCss: ['./src/styles/custom.css'],
      social: {
        github: 'https://github.com/rool-dev/rool-js',
      },
      sidebar: [
        { label: 'Overview', link: '/' },
        {
          label: 'Products',
          items: [
            { label: 'Console', link: '/console/' },
            { label: 'SDK', link: '/sdk/' },
            { label: 'CLI', link: '/cli/' },
          ],
        },
      ],
      pagination: false,
    }),
  ],
});
