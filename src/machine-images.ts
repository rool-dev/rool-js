import type { RoolClientEvent } from "./events.js";
import { jsonRequest, type RoolTransport } from "./transport.js";
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
import { WatchedValue } from "./watched-value.js";

export interface AccountMachineImagesApi {
  list(): Promise<MachineImage[]>;
  /** A name the account already uses gets a number after it;
   *  `machine_image_not_listed` for an id the Hub does not list. */
  copyFromHub(hubMachineImageId: string): Promise<CopiedMachineImage>;
}

export class AccountMachineImagesClient implements AccountMachineImagesApi {
  private readonly path: string;

  constructor(
    accountPath: string,
    private readonly transport: RoolTransport,
  ) {
    this.path = `${accountPath}/machine-images`;
  }

  async list(): Promise<MachineImage[]> {
    const { machineImages } = await this.transport.requestJson<{
      machineImages: MachineImage[];
    }>(this.path);
    return machineImages;
  }

  copyFromHub(hubMachineImageId: string): Promise<CopiedMachineImage> {
    return this.transport.requestJson(
      this.path,
      jsonRequest("POST", { from: hubMachineImageId }),
    );
  }
}

/** One machine image of an account. New revisions are saved from a machine in
 *  edit mode, not here. */
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
  /** Restarts the machine. Only for the owner of a machine with no other
   *  members; `machine_image_not_available` off a plan with `machineImages`. */
  startEditing(): Promise<void>;
  /** Leaves edit mode without saving and restarts the machine. */
  discardEdits(): Promise<void>;
}

export class MachineImageSelectionClient implements MachineImageSelectionApi {
  private readonly path: string;
  private readonly watched: WatchedValue<MachineImageState | null>;

  constructor(
    machineId: string,
    machinePath: string,
    private readonly transport: RoolTransport & {
      subscribeEvents(listener: (event: RoolClientEvent) => void): () => void;
    },
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

  async discardEdits(): Promise<void> {
    await this.transport.request(`${this.path}/discard`, { method: "POST" });
  }
}
