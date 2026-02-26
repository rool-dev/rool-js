---
title: App Hosting
description: Publish and host single-page applications on rool.app subdomains.
---

Rool let's you host single-page applications on `rool.app` subdomains. Publish a built directory and get a live URL instantly.

## How It Works

Each published app gets a subdomain based on your **app ID**:

```
https://{app-id}.rool.app/
```

For example, publishing with app ID `my-app` makes it available at `https://my-app.rool.app/`.

Apps are static SPAs — upload a build directory containing an `index.html` and your bundled assets. Rool serves them with SPA routing enabled by default, so client-side routes work out of the box.

## Publishing

Use the CLI to publish a directory:

```bash
# Build your app first
npm run build

# Publish the output directory
rool app publish my-app ./dist
```

The app ID must be URL-safe (alphanumeric, hyphens, underscores), is case-insensitive (always lowercased), and becomes the subdomain.

### Options

| Option | Description |
|--------|-------------|
| `-n, --name <name>` | Display name (defaults to app ID) |

```bash
# Publish with a display name
rool app publish my-app ./dist -n "My App"
```

### Updating

Publishing to the same app ID replaces the previous version. There's no versioning — the latest publish is what's live.

```bash
# Rebuild and republish
npm run build
rool app publish my-app ./dist
```

## Managing Apps

```bash
# List your published apps
rool app list

# Remove an app
rool app unpublish my-app
```

## Publishing via the SDK

You can also publish programmatically:

```typescript
import { RoolClient } from '@rool-dev/sdk';

const client = new RoolClient();
await client.initialize();

// Publish a zip bundle
const result = await client.publishApp('my-app', {
  name: 'My App',
  bundle: zipBlob, // Zip file containing index.html at root
  spa: true,
});

console.log(result.url); // https://my-app.rool.app/
```

| Method | Description |
|--------|-------------|
| `publishApp(appId, options)` | Publish or update an app |
| `listApps()` | List all your published apps |
| `getAppInfo(appId)` | Get info for a specific app (or null) |
| `unpublishApp(appId)` | Remove an app |

## User Slug

Your user slug is part of your identity on the platform. View or change it with:

```bash
# View your current slug
rool app slug

# Set a new slug
rool app slug my-slug
```

Slugs must be 3–32 characters, start with a letter, and contain only lowercase letters, numbers, hyphens, and underscores. Your slug cannot be changed once you have published apps.

## Requirements

- Apps must be **single-page applications**
- The build directory must contain an `index.html` at the root
- Maximum bundle size: **100 MB**

## Limits

The number of apps you can publish depends on your plan. Check your current plan with `rool user`.

## License

MIT - see [LICENSE](https://github.com/rool-dev/rool-js/blob/main/LICENSE) for details.
