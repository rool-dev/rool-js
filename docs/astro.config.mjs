import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://docs.rool.dev",
  redirects: { "/sdk": "/" },
  integrations: [
    starlight({
      title: "Rool",
      logo: {
        src: "./src/assets/rool.svg",
        replacesTitle: true,
      },
      customCss: ["./src/styles/custom.css"],
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/rool-dev/rool-js",
        },
      ],
      sidebar: [
        { label: "Get started", link: "/" },
        {
          label: "Use the SDK",
          items: [
            {
              label: "Client and account",
              link: "/client-and-account/",
            },
            {
              label: "Machines and sharing",
              link: "/machines-and-sharing/",
            },
            { label: "Files", link: "/files/" },
            {
              label: "Agents and conversations",
              link: "/agents-and-conversations/",
            },
            { label: "Structured data", link: "/structured-data/" },
            { label: "Live updates", link: "/live-updates/" },
          ],
        },
      ],
      pagination: false,
    }),
  ],
});
