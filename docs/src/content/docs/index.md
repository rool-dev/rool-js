---
title: Rool Documentation
description: Build extensions that extend Rool Spaces with custom AI-powered experiences. TypeScript SDK, Svelte bindings, and CLI.
---

A Rool Space is a persistent, collaborative environment for organizing objects and their relationships. AI in a Rool Space operates on a structured world model — objects, schema, references — rather than a text conversation.

Extensions add features to a Space. Productivity tools, dashboards, data views, games — anything can be built as an extension and installed into a Space. Multiple extensions can run in the same Space, letting users and teams assemble an AI-powered interface that fits exactly how they work.

## Getting Started

[Rool](https://rool.app) is a chat-centered AI web app with object-based memory that can be customized with vibe-coded extensions. Sign up at [rool.app](https://rool.app) and familiarize yourself with the environment. Create a few spaces, chat with them, add and remove objects. You can install example extensions like Chat, Flashcards, and Snake directly from the extension directory inside any Space.

When you're ready to build your own extension, scaffold a new project with the CLI:

```bash
npm install -g @rool-dev/cli
rool extension create my-extension
cd my-extension && npm install && npm run dev
```

For detailed API documentation, read the [Extension docs](/extension/) or point your coding agent at them.

## Developer Tools

### Extension

Build extensions that extend Rool Spaces. Extensions are Svelte 5 components hosted in sandboxed iframes with a reactive channel bridge to the Space's objects, schema, AI, and real-time events.

[Read Extension Docs](/extension/)

### SDK

The TypeScript SDK for integrating Rool Spaces into existing applications, Node.js scripts, or advanced use cases outside the extension sandbox.

[Read SDK Docs](/sdk/)

### Svelte

Reactive Svelte 5 bindings for the SDK using native runes.

[Read Svelte Docs](/svelte/)

### CLI

Manage and interact with Rool Spaces and extensions from the command line.

[Read CLI Docs](/cli/)
