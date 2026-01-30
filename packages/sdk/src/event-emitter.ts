// =============================================================================
// Typed EventEmitter
// Framework-agnostic event emitter that works in browser and Node.js
// =============================================================================

/**
 * Generic event map type - keys are event names, values are listener signatures
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EventMap = Record<string, (...args: any[]) => void>;

/**
 * Simple typed EventEmitter implementation.
 * Works in browser and Node.js environments without dependencies.
 */
export class EventEmitter<Events extends EventMap> {
  private listeners = new Map<keyof Events, Set<Events[keyof Events]>>();

  /**
   * Register an event listener.
   * @returns Unsubscribe function
   */
  on<K extends keyof Events>(event: K, listener: Events[K]): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);

    return () => this.off(event, listener);
  }

  /**
   * Remove an event listener.
   */
  off<K extends keyof Events>(event: K, listener: Events[K]): void {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(listener);
      if (set.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  /**
   * Register a one-time event listener.
   * @returns Unsubscribe function
   */
  once<K extends keyof Events>(event: K, listener: Events[K]): () => void {
    const wrapper = ((...args: Parameters<Events[K]>) => {
      this.off(event, wrapper as Events[K]);
      (listener as (...args: Parameters<Events[K]>) => void)(...args);
    }) as Events[K];

    return this.on(event, wrapper);
  }

  /**
   * Emit an event to all registered listeners.
   */
  protected emit<K extends keyof Events>(
    event: K,
    ...args: Parameters<Events[K]>
  ): void {
    const set = this.listeners.get(event);
    if (set) {
      // Copy to array to allow listeners to unsubscribe during emit
      for (const listener of Array.from(set)) {
        try {
          (listener as (...args: Parameters<Events[K]>) => void)(...args);
        } catch (error) {
          console.error(`Error in event listener for "${String(event)}":`, error);
        }
      }
    }
  }

  /**
   * Remove all listeners for a specific event, or all listeners if no event specified.
   */
  removeAllListeners<K extends keyof Events>(event?: K): void {
    if (event !== undefined) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  /**
   * Get the number of listeners for a specific event.
   */
  listenerCount<K extends keyof Events>(event: K): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}

