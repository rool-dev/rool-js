---
title: Rool Documentation
description: Build apps that extend Rool Spaces with custom AI-powered experiences. TypeScript SDK, Svelte bindings, and CLI.
---

A Rool Space is a persistent, collaborative environment for organizing objects and their relationships. AI in a Rool Space operates on a structured world model — objects, schema, references — rather than a text conversation.

Apps are extensions that add features to a Space. Productivity tools, dashboards, data views, games — anything can be built as an app and installed into a Space. Multiple apps can run in the same Space, letting users and teams assemble an AI-powered interface that fits exactly how they work.

## Getting Started

Sign up via the [Console](https://console.rool.dev) and familiarize yourself with the environment. Create a few spaces, chat with them, add and remove objects. You can install example apps like Chat, Flashcards, and Snake directly from the app directory inside any Space.

When you're ready to build your own app, scaffold a new project with the CLI:

```bash
npm install -g @rool-dev/cli
rool app create my-app
cd my-app && npm install && npm run dev
```

For detailed API documentation, read the [App docs](/app/) or point your coding agent at them.

## Products

### Console

The web application for managing your spaces. Create, explore, and collaborate on spaces with a visual interface. Install apps from the directory or build your own.

[Open Console](https://console.rool.dev)

### App

Build apps that extend Rool Spaces. Apps are Svelte 5 components hosted in sandboxed iframes with a reactive channel bridge to the Space's objects, schema, AI, and real-time events.

[Read App Docs](/app/)

### SDK

The TypeScript SDK for integrating Rool Spaces into existing applications, Node.js scripts, or advanced use cases outside the app sandbox.

[Read SDK Docs](/sdk/)

### Svelte

Reactive Svelte 5 bindings for the SDK using native runes.

[Read Svelte Docs](/svelte/)

### CLI

Manage and interact with Rool Spaces and Apps from the command line.

[Read CLI Docs](/cli/)
