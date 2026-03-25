# Server Rename: `app` → `extension`

The SDK has been renamed from "app" to "extension" throughout. The server still uses the old names, so the SDK maintains mapping layers to translate between them. This document describes the server changes needed to align with the new naming and remove those mappings.

## GraphQL

### Field renames

| Location | Current | Target |
|----------|---------|--------|
| `ChannelInfo.appUrl` | `appUrl` | `extensionUrl` |
| `Channel.appUrl` (nested in `openChannel`, `channel_updated` SSE) | `appUrl` | `extensionUrl` |
| `PublishedExtensionInfo.appId` | `appId` | `extensionId` |

### Query/mutation renames

| Current | Target |
|---------|--------|
| `findApps(query, limit)` | `findExtensions(query, limit)` |
| `installApp(spaceId, appId, channelId)` | `installExtension(spaceId, extensionId, channelId)` |

The `installApp` mutation parameter `appId` should become `extensionId`.

### Full details

**`openSpace` query** — the `channels` field returns objects with `appUrl`. Rename to `extensionUrl`:

```graphql
# Current
openSpace(id: $id) {
  channels {
    appUrl    # ← rename
  }
}

# Target
openSpace(id: $id) {
  channels {
    extensionUrl
  }
}
```

**`openChannel` query** — the `channel` JSON blob contains an `appUrl` key. Rename to `extensionUrl`:

```
channel: { ..., "appUrl": "https://..." }
→
channel: { ..., "extensionUrl": "https://..." }
```

**`findApps` query** — rename the query and its return field:

```graphql
# Current
query FindApps($query: String, $limit: Int) {
  findApps(query: $query, limit: $limit) {
    appId
    manifest
    url
    sizeBytes
  }
}

# Target
query FindExtensions($query: String, $limit: Int) {
  findExtensions(query: $query, limit: $limit) {
    extensionId
    manifest
    url
    sizeBytes
  }
}
```

**`installApp` mutation** — rename the mutation and its parameter:

```graphql
# Current
mutation InstallApp($spaceId: String!, $appId: String!, $channelId: String!) {
  installApp(spaceId: $spaceId, appId: $appId, channelId: $channelId)
}

# Target
mutation InstallExtension($spaceId: String!, $extensionId: String!, $channelId: String!) {
  installExtension(spaceId: $spaceId, extensionId: $extensionId, channelId: $channelId)
}
```

## REST API

The extensions REST endpoint path and response field need renaming.

| Current | Target |
|---------|--------|
| `GET /apps` | `GET /extensions` |
| `GET /apps/:id` | `GET /extensions/:id` |
| `POST /apps/:id` | `POST /extensions/:id` |
| `DELETE /apps/:id` | `DELETE /extensions/:id` |

Response bodies currently return `appId` — rename to `extensionId`:

```json
// Current
{ "appId": "my-extension", "manifest": {...}, "url": "...", "sizeBytes": 1234 }

// Target
{ "extensionId": "my-extension", "manifest": {...}, "url": "...", "sizeBytes": 1234 }
```

## SSE Events

Two SSE event types include the old field name:

**`channel_created`** — the event payload includes `appUrl`. Rename to `extensionUrl`:

```json
// Current
{ "type": "channel_created", "channelId": "...", "appUrl": "https://..." }

// Target
{ "type": "channel_created", "channelId": "...", "extensionUrl": "https://..." }
```

**`channel_updated`** — the nested `channel` object includes `appUrl`. Rename to `extensionUrl`:

```json
// Current
{ "type": "channel_updated", "channel": { "appUrl": "https://..." } }

// Target
{ "type": "channel_updated", "channel": { "extensionUrl": "https://..." } }
```

## SDK Cleanup After Server Changes

Once the server is updated, these SDK mapping layers can be removed:

1. **`graphql.ts` `openSpace`** — remove the `appUrl → extensionUrl` remapping of channels (line ~114)
2. **`graphql.ts` `openChannel`** — remove the `appUrl → extensionUrl` remapping of the channel blob (lines ~153–167)
3. **`graphql.ts` `findExtensions`** — use `findExtensions` query directly, remove `appId → extensionId` remapping (lines ~638–656)
4. **`graphql.ts` `installExtension`** — use `installExtension` mutation directly, remove `appId: extensionId` variable mapping (lines ~659–671)
5. **`subscription.ts` `channel_created`** — read `extensionUrl` directly instead of `raw.appUrl` (line ~241)
6. **`subscription.ts` `channel_updated`** — read `extensionUrl` directly from channel object, remove `appUrl` destructuring (lines ~509–514)
7. **`apps.ts` `mapExtensionInfo`** — delete the helper; server returns `extensionId` directly
8. **`apps.ts` URL config** — rename `appsUrl` config field to `extensionsUrl`, update `client.ts` URL from `/apps` to `/extensions`
9. **`apps.ts`** — rename file to `extensions.ts` for consistency
