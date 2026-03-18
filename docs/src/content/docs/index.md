---
title: Rool Documentation
description: Build applications where AI operates on a structured world model. TypeScript SDK, Svelte bindings, and CLI for Rool Spaces.
---

Rool Spaces is a persistent and collaborative environment for organizing objects and their relationships. Build applications where AI operates on a structured world model rather than a text conversation.

## Getting Started

To use Rool, you first need a Rool account. Sign up via the [Console](https://console.rool.dev) and familiarize yourself with the environment. Create a few spaces, chat with them, add and remove objects.

The Rool Console is a perfectly valid replacement for AI tools like ChatGPT or Google Gemini: a chat with a powerful memory. But the real power of Rool Spaces comes from building and using apps that leverage them.

Many Rool apps can access the same space. You can create spaces shared between friends, family, your team, or your company.

When you're ready to build your first Rool app, scaffold a new project with the CLI:

```bash
npm install -g @rool-dev/cli
rool create my-app
cd my-app && npm install && npm run dev
```

For detailed API documentation, read the [App docs](/app/) or point your coding agent at them.

## Demo Apps

Try these example apps to see what you can build with Rool Spaces.

| App | Description | Links |
|-----|-------------|-------|
| <a href="https://chat.rool.app/" style="white-space:nowrap"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 64 64" style="display:inline;vertical-align:middle;margin-right:0.5rem"><rect width="64" height="64" rx="12" fill="#6366f1"/><path d="M16 20h24a4 4 0 0 1 4 4v12a4 4 0 0 1-4 4H28l-8 6v-6h-4a4 4 0 0 1-4-4V24a4 4 0 0 1 4-4z" fill="white" opacity="0.9"/><circle cx="24" cy="30" r="2" fill="#6366f1"/><circle cx="32" cy="30" r="2" fill="#6366f1"/></svg>Chat</a> | AI chat with persistent history and markdown | [Try App](https://chat.rool.app/) · [Source](https://github.com/rool-dev/rool-js/tree/main/examples/chat) |
| <a href="https://flashcards.rool.app/" style="white-space:nowrap"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 64 64" style="display:inline;vertical-align:middle;margin-right:0.5rem"><rect width="64" height="64" rx="12" fill="#f59e0b"/><rect x="14" y="18" width="28" height="20" rx="3" fill="white" opacity="0.5" transform="rotate(-6 28 28)"/><rect x="18" y="22" width="28" height="20" rx="3" fill="white" opacity="0.9"/><line x1="24" y1="30" x2="40" y2="30" stroke="#f59e0b" stroke-width="2" stroke-linecap="round"/><line x1="24" y1="35" x2="34" y2="35" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" opacity="0.5"/></svg>Flashcards</a> | Spaced repetition with SM-2 scheduling | [Try App](https://flashcards.rool.app/) · [Source](https://github.com/rool-dev/rool-js/tree/main/examples/flashcards) |
| <a href="https://soft-sql.rool.app/" style="white-space:nowrap"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 64 64" style="display:inline;vertical-align:middle;margin-right:0.5rem"><rect width="64" height="64" rx="12" fill="#0ea5e9"/><ellipse cx="32" cy="22" rx="16" ry="6" fill="white" opacity="0.9"/><path d="M16 22v20c0 3.3 7.2 6 16 6s16-2.7 16-6V22" fill="none" stroke="white" stroke-width="2.5" opacity="0.9"/><path d="M16 30c0 3.3 7.2 6 16 6s16-2.7 16-6" fill="none" stroke="white" stroke-width="2" opacity="0.5"/><path d="M16 38c0 3.3 7.2 6 16 6s16-2.7 16-6" fill="none" stroke="white" stroke-width="2" opacity="0.5"/></svg>Soft SQL</a> | Natural language queries with table results | [Try App](https://soft-sql.rool.app/) · [Source](https://github.com/rool-dev/rool-js/tree/main/examples/soft-sql) |
| <a href="https://roodle.rool.app/" style="white-space:nowrap"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 64 64" style="display:inline;vertical-align:middle;margin-right:0.5rem"><rect width="64" height="64" rx="12" fill="#ec4899"/><rect x="14" y="20" width="36" height="28" rx="3" fill="white" opacity="0.9"/><rect x="14" y="20" width="36" height="8" rx="3" fill="white"/><line x1="26" y1="20" x2="26" y2="15" stroke="white" stroke-width="3" stroke-linecap="round"/><line x1="38" y1="20" x2="38" y2="15" stroke="white" stroke-width="3" stroke-linecap="round"/><rect x="20" y="33" width="6" height="5" rx="1" fill="#ec4899" opacity="0.3"/><rect x="29" y="33" width="6" height="5" rx="1" fill="#ec4899"/><rect x="38" y="33" width="6" height="5" rx="1" fill="#ec4899" opacity="0.3"/><rect x="20" y="40" width="6" height="5" rx="1" fill="#ec4899" opacity="0.3"/><rect x="29" y="40" width="6" height="5" rx="1" fill="#ec4899" opacity="0.3"/></svg>Roodle</a> | AI-powered collaborative scheduling | [Try App](https://roodle.rool.app/) · [Source](https://github.com/rool-dev/rool-js/tree/main/examples/roodle) |

## Products

### Console

The web application for managing your spaces. Create, explore, and collaborate on spaces with a powerful visual interface.

[Open Console](https://console.rool.dev)

### App

Build sandboxed apps that run inside Rool Spaces. Svelte 5 components hosted in iframes with a reactive channel bridge.

[Read App Docs](/app/)

### SDK

Integrate Rool Spaces with other apps using the TypeScript SDK.

[Read SDK Docs](/sdk/)

### Svelte

Reactive Svelte 5 bindings for the SDK using native runes.

[Read Svelte Docs](/svelte/)


### CLI

Manage and interact with Rool Spaces and Rool Apps from the command line.

[Read CLI Docs](/cli/)
