import type { RoolSpace, ChannelInfo, ConnectionState, RoolUserRole, LinkAccess, SpaceMember } from '@rool-dev/sdk';
import { wrapChannel, type ReactiveChannel } from './channel.svelte.js';

/**
 * A reactive wrapper around a RoolSpace. Exposes reactive `channels` and
 * `connectionState`, and provides `openChannel()` that returns a ReactiveChannel.
 *
 * Lifecycle: call `close()` when done. Closes all opened channels and stops the
 * space's SSE subscription.
 */
class ReactiveSpaceImpl {
  #space: RoolSpace;
  #channels = new Map<string, ReactiveChannel>();
  #unsubscribers: (() => void)[] = [];
  #closed = false;

  // Reactive state mirroring the underlying space
  #channelList = $state<ChannelInfo[]>([]);
  connectionState = $state<ConnectionState>('reconnecting');

  constructor(space: RoolSpace) {
    this.#space = space;
    this.#channelList = space.channels;

    const refreshChannels = () => { this.#channelList = space.channels; };
    space.on('channelCreated', refreshChannels);
    space.on('channelUpdated', refreshChannels);
    space.on('channelDeleted', refreshChannels);
    this.#unsubscribers.push(() => space.off('channelCreated', refreshChannels));
    this.#unsubscribers.push(() => space.off('channelUpdated', refreshChannels));
    this.#unsubscribers.push(() => space.off('channelDeleted', refreshChannels));

    const onConnectionStateChanged = (state: ConnectionState) => {
      this.connectionState = state;
    };
    space.on('connectionStateChanged', onConnectionStateChanged);
    this.#unsubscribers.push(() => space.off('connectionStateChanged', onConnectionStateChanged));
  }

  get isClosed() { return this.#closed; }

  /**
   * Open a channel on this space. Returns a ReactiveChannel with reactive state.
   * Repeated calls with the same channelId return the same instance (until closed).
   */
  async openChannel(channelId: string): Promise<ReactiveChannel> {
    if (this.#closed) throw new Error('Cannot open channel: space is closed');

    const existing = this.#channels.get(channelId);
    if (existing && !existing.isClosed) return existing;

    const raw = await this.#space.openChannel(channelId);
    const reactive = wrapChannel(raw);
    this.#channels.set(channelId, reactive);
    return reactive;
  }

  /**
   * Close this space: closes all open reactive channels and stops the SSE
   * subscription. Idempotent.
   */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;

    for (const ch of this.#channels.values()) {
      ch.close();
    }
    this.#channels.clear();

    for (const unsub of this.#unsubscribers) unsub();
    this.#unsubscribers.length = 0;

    this.#space.close();
  }

  // Reactive getters
  get channels(): ChannelInfo[] { return this.#channelList; }

  // Proxy read-only properties
  get id(): string { return this.#space.id; }
  get name(): string { return this.#space.name; }
  get role(): RoolUserRole { return this.#space.role; }
  get linkAccess(): LinkAccess { return this.#space.linkAccess; }
  get memberCount(): number { return this.#space.memberCount; }

  // Proxy admin methods
  rename(newName: string): Promise<void> { return this.#space.rename(newName); }
  delete(): Promise<void> { return this.#space.delete(); }
  listUsers(): Promise<SpaceMember[]> { return this.#space.listUsers(); }
  addUser(...args: Parameters<RoolSpace['addUser']>) { return this.#space.addUser(...args); }
  removeUser(userId: string): Promise<void> { return this.#space.removeUser(userId); }
  setLinkAccess(...args: Parameters<RoolSpace['setLinkAccess']>) { return this.#space.setLinkAccess(...args); }
  renameChannel(channelId: string, name: string): Promise<void> { return this.#space.renameChannel(channelId, name); }
  deleteChannel(channelId: string): Promise<void> { return this.#space.deleteChannel(channelId); }
  exportArchive(): Promise<Blob> { return this.#space.exportArchive(); }
  refresh(): Promise<void> { return this.#space.refresh(); }

  // Events on the underlying space (channelCreated/Updated/Deleted, connectionStateChanged)
  on(...args: Parameters<RoolSpace['on']>) { return this.#space.on(...args); }
  off(...args: Parameters<RoolSpace['off']>) { return this.#space.off(...args); }
}

export function wrapSpace(space: RoolSpace): ReactiveSpace {
  return new ReactiveSpaceImpl(space);
}

export type ReactiveSpace = ReactiveSpaceImpl;
