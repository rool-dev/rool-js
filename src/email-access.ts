import type { RoolClientEvent } from "./events.js";
import type { EmailAccessAddress } from "./types.js";
import { WatchedList } from "./watched-list.js";

export interface EmailAccessView {
  readonly addresses: readonly EmailAccessAddress[];
  readonly loading: boolean;
  readonly error: unknown;
}

export type EmailAccessListener = (view: EmailAccessView) => void;

export interface EmailAccessApi {
  list(): Promise<EmailAccessAddress[]>;
  watch(listener: EmailAccessListener): () => void;
  requestConfirmation(email: string): Promise<EmailAccessAddress>;
  remove(addressId: string): Promise<void>;
}

interface EmailAccessTransport {
  request(path: string, init?: RequestInit): Promise<Response>;
  requestJson<T>(path: string, init?: RequestInit): Promise<T>;
  subscribeEvents(listener: (event: RoolClientEvent) => void): () => void;
}

export class EmailAccessClient implements EmailAccessApi {
  private readonly watched: WatchedList<EmailAccessAddress>;

  constructor(private readonly transport: EmailAccessTransport) {
    this.watched = new WatchedList(
      (signal) => this.load(signal),
      (listener) => transport.subscribeEvents(listener),
      (event) => event.type === "email_access_changed",
    );
  }

  list(): Promise<EmailAccessAddress[]> {
    return this.load();
  }

  watch(listener: EmailAccessListener): () => void {
    return this.watched.watch(({ items, loading, error }) => listener({ addresses: items, loading, error }));
  }

  private async load(signal?: AbortSignal): Promise<EmailAccessAddress[]> {
    const { addresses } = await this.transport.requestJson<{ addresses: EmailAccessAddress[] }>(
      "/v2/me/email-access", { signal },
    );
    return addresses;
  }

  async requestConfirmation(email: string): Promise<EmailAccessAddress> {
    const generation = this.watched.generation;
    const address = await this.transport.requestJson<EmailAccessAddress>("/v2/me/email-access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    this.watched.update(generation, (items) => items.some(item => item.id === address.id)
      ? items.map(item => item.id === address.id ? address : item)
      : [...items, address]);
    return address;
  }

  async remove(addressId: string): Promise<void> {
    const generation = this.watched.generation;
    await this.transport.request(`/v2/me/email-access/${encodeURIComponent(addressId)}`, {
      method: "DELETE",
    });
    this.watched.update(generation, (items) => items.filter(item => item.id !== addressId));
  }
}
