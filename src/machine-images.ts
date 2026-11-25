import { jsonRequest, type RoolTransport, type RoolWatchingTransport } from "./transport.js";
import type {
  CopiedMachineImage,
  HubMachineImage,
  HubMachineImageDetail,
  MachineImage,
  MachineImageCopyUpdate,
  MachineImageDefaultChange,
  MachineImageRevision,
  MachineImageSettings,
  MachineImageState,
  MachineImageSubmission,
} from "./types.js";
import { fetchMachineImageArchive, type MachineImageArchive } from "./machine-image-files.js";
import { WatchedValue } from "./watched-value.js";

export interface AccountMachineImagesView {
  readonly machineImages: readonly MachineImage[];
  readonly loading: boolean;
  readonly error: unknown;
}

export type AccountMachineImagesListener = (
  view: AccountMachineImagesView,
) => void;

export interface AccountMachineImagesApi {
  list(): Promise<MachineImage[]>;
  /** The list now and whenever it changes: a save, a rename, a new default
   *  revision, a review. */
  watch(listener: AccountMachineImagesListener): () => void;
  /** A name the account already uses gets a number after it;
   *  `machine_image_not_listed` for an id the Hub does not list. */
  copyFromHub(hubMachineImageId: string): Promise<CopiedMachineImage>;
}

export class AccountMachineImagesClient implements AccountMachineImagesApi {
  private readonly path: string;
  private readonly watched: WatchedValue<MachineImage[]>;

  constructor(
    accountId: string,
    accountPath: string,
    private readonly transport: RoolWatchingTransport,
  ) {
    this.path = `${accountPath}/machine-images`;
    this.watched = new WatchedValue(
      (signal) => this.load(signal),
      (listener) => transport.subscribeEvents(listener),
      (event) =>
        event.type === "account_changed" && event.accountId === accountId,
      () => [],
    );
  }

  list(): Promise<MachineImage[]> {
    return this.load();
  }

  watch(listener: AccountMachineImagesListener): () => void {
    return this.watched.watch(({ value, loading, error }) =>
      listener({ machineImages: [...value], loading, error }),
    );
  }

  copyFromHub(hubMachineImageId: string): Promise<CopiedMachineImage> {
    return this.transport.requestJson(
      this.path,
      jsonRequest("POST", { from: hubMachineImageId }),
    );
  }

  private async load(signal?: AbortSignal): Promise<MachineImage[]> {
    const { machineImages } = await this.transport.requestJson<{
      machineImages: MachineImage[];
    }>(this.path, { signal });
    return machineImages;
  }
}

/** One machine image of an account. New revisions are saved from a machine in
 *  edit mode: `machine(id).machineImage.save()`. */
export class RoolMachineImageApi {
  private readonly path: string;

  constructor(
    readonly id: string,
    private readonly transport: RoolTransport,
  ) {
    if (!id) throw new Error("machineImageId is required");
    this.path = `/v2/machine-images/${encodeURIComponent(id)}`;
  }

  get(): Promise<MachineImage> {
    return this.transport.requestJson(this.path);
  }

  getRevision(revision: number): Promise<MachineImageRevision> {
    return this.transport.requestJson(`${this.path}/revisions/${revision}`);
  }

  /** The contents of a revision's files, fetched all at once. */
  files(revision: number): Promise<MachineImageArchive> {
    return fetchMachineImageArchive(() =>
      this.transport.request(`${this.path}/revisions/${revision}/files`),
    );
  }

  /** `machine_image_name_taken` for a name the account already uses. */
  update(settings: Partial<MachineImageSettings>): Promise<MachineImage> {
    return this.transport.requestJson(
      this.path,
      jsonRequest("PATCH", settings),
    );
  }

  /** Restarts every machine whose system this changes. */
  setDefaultRevision(revision: number): Promise<MachineImageDefaultChange> {
    return this.transport.requestJson(
      `${this.path}/default-revision`,
      jsonRequest("PUT", { revision }),
    );
  }

  /** `machine_image_in_use` while machines run it. */
  async delete(): Promise<void> {
    await this.transport.request(this.path, { method: "DELETE" });
  }

  /** Puts a revision, by default the default one, up for review for the Hub;
   *  `machine_image_submitted` while another waits. */
  submit(revision?: number): Promise<MachineImageSubmission> {
    return this.transport.requestJson(
      `${this.path}/submissions`,
      jsonRequest("POST", revision === undefined ? {} : { revision }),
    );
  }

  /** Takes it off the Hub and withdraws a waiting submission. */
  async unlist(): Promise<void> {
    await this.transport.request(`${this.path}/listing`, { method: "DELETE" });
  }

  /** Adds the revision the Hub lists now to a copy, without making it the
   *  default; `machine_image_up_to_date` or `machine_image_no_source` otherwise. */
  updateCopy(): Promise<MachineImageCopyUpdate> {
    return this.transport.requestJson(`${this.path}/copy-update`, {
      method: "POST",
    });
  }
}

export interface HubMachineImagesApi {
  list(): Promise<HubMachineImage[]>;
  /** `machine_image_not_listed` for an id the Hub does not list. */
  get(machineImageId: string): Promise<HubMachineImageDetail>;
  /** The contents of a listed machine image's files, fetched all at once. */
  files(machineImageId: string): Promise<MachineImageArchive>;
}

export interface RoolHubApi {
  readonly machineImages: HubMachineImagesApi;
}

export class HubMachineImagesClient implements HubMachineImagesApi {
  constructor(private readonly transport: RoolTransport) {}

  async list(): Promise<HubMachineImage[]> {
    const { machineImages } = await this.transport.requestJson<{
      machineImages: HubMachineImage[];
    }>("/v2/hub/machine-images");
    return machineImages;
  }

  get(machineImageId: string): Promise<HubMachineImageDetail> {
    return this.transport.requestJson(
      `/v2/hub/machine-images/${encodeURIComponent(machineImageId)}`,
    );
  }

  files(machineImageId: string): Promise<MachineImageArchive> {
    return fetchMachineImageArchive(() =>
      this.transport.request(
        `/v2/hub/machine-images/${encodeURIComponent(machineImageId)}/files`,
      ),
    );
  }
}

export interface MachineImageStateView {
  /** null until first loaded. */
  readonly state: MachineImageState | null;
  readonly loading: boolean;
  readonly error: unknown;
}

export type MachineImageStateListener = (view: MachineImageStateView) => void;

/** The machine image one machine runs. */
export interface MachineImageSelectionApi {
  get(): Promise<MachineImageState>;
  watch(listener: MachineImageStateListener): () => void;
  /** null for the stock system. Resolves once asked; the machine restarts
   *  when the revision is built, so `watch()` for `changing` and `error`. */
  use(machineImageId: string | null): Promise<void>;
  /** Restarts the machine. Refused when `MachineImageState.editRefusal` is
   *  set; `machine_image_not_available` for `plan`. */
  startEditing(): Promise<void>;
  /** Saves the edit as the machine image's next revision. Resolves once
   *  asked, like `use()`; `machine_image_not_saved` when it cannot be. */
  save(): Promise<void>;
  /** Saves the edit as a new machine image; the only save on the stock system. */
  saveAs(settings: MachineImageSettings): Promise<void>;
  /** Leaves edit mode without saving and restarts the machine. */
  discardEdits(): Promise<void>;
}

export class MachineImageSelectionClient implements MachineImageSelectionApi {
  private readonly path: string;
  private readonly watched: WatchedValue<MachineImageState | null>;

  constructor(
    machineId: string,
    machinePath: string,
    private readonly transport: RoolWatchingTransport,
  ) {
    this.path = `${machinePath}/machine-image`;
    this.watched = new WatchedValue<MachineImageState | null>(
      (signal) => this.transport.requestJson(this.path, { signal }),
      (listener) => transport.subscribeEvents(listener),
      (event) =>
        event.type === "machines_changed" && event.machineId === machineId,
      () => null,
    );
  }

  get(): Promise<MachineImageState> {
    return this.transport.requestJson(this.path);
  }

  watch(listener: MachineImageStateListener): () => void {
    return this.watched.watch(({ value, loading, error }) =>
      listener({ state: value, loading, error }),
    );
  }

  async use(machineImageId: string | null): Promise<void> {
    await this.transport.request(
      this.path,
      jsonRequest("PUT", { machineImageId }),
    );
  }

  async startEditing(): Promise<void> {
    await this.transport.request(`${this.path}/edit`, { method: "POST" });
  }

  async save(): Promise<void> {
    await this.transport.request(`${this.path}/save`, jsonRequest("POST", {}));
  }

  async saveAs({ name, description }: MachineImageSettings): Promise<void> {
    await this.transport.request(
      `${this.path}/save`,
      jsonRequest("POST", { name, description }),
    );
  }

  async discardEdits(): Promise<void> {
    await this.transport.request(`${this.path}/discard`, { method: "POST" });
  }
}
