import assert from "node:assert/strict";
import {
  RoolClient,
  RoolProblem,
  roolSdkVersion,
  type MachineFiles,
} from "../../../src/index.js";
import { createTestAuth, type TestAuthProfile } from "./auth.js";

export const API_URL = (
  process.env.ROOL_TEST_API_URL ?? "http://localhost:1357"
).replace(/\/+$/, "");
export const ROUTER_URL = (
  process.env.ROOL_TEST_ROUTER_URL ?? "http://localhost:8080"
).replace(/\/+$/, "");

function requestUrl(input: RequestInfo | URL): URL {
  return new URL(
    typeof input === "string" || input instanceof URL ? input : input.url,
  );
}

export function createRoutedFetch(authenticated = true): typeof fetch {
  return (input, init) => {
    const url = requestUrl(input);
    const segments = url.pathname.split("/").filter(Boolean);
    const isMachineRoute =
      segments[0] === "v2" &&
      segments[1] === "machines" &&
      segments.length >= 3;
    if (isMachineRoute) {
      const routerUrl = new URL(ROUTER_URL);
      url.protocol = routerUrl.protocol;
      url.host = routerUrl.host;
    }

    const headers = new Headers(init?.headers);
    assert.equal(headers.get("X-Rool-SDK-Name"), "@rool-dev/sdk");
    assert.equal(headers.get("X-Rool-SDK-Version"), roolSdkVersion);
    if (authenticated) {
      assert.equal(headers.get("Authorization")?.startsWith("Bearer "), true);
    } else {
      assert.equal(headers.has("Authorization"), false);
    }
    return fetch(url, { ...init, headers });
  };
}

export function createTestClient(
  profile: TestAuthProfile | null = "primary",
  fetchRequest = createRoutedFetch(profile !== null),
): RoolClient {
  const auth = profile ? createTestAuth(API_URL, profile) : null;
  return new RoolClient({
    apiUrl: API_URL,
    getTokens: auth?.getTokens,
    onAuthInvalidated: auth?.logout,
    fetch: fetchRequest,
  });
}

export async function requireLocalRouter(): Promise<void> {
  const health = await fetch(`${ROUTER_URL}/health`).catch(() => null);
  if (health?.status !== 200) {
    throw new Error(
      `The local machine router is not available at ${ROUTER_URL}`,
    );
  }
}

export class MachineCleanup {
  private readonly machineIds = new Set<string>();

  constructor(private readonly client: RoolClient) {}

  track<T extends { id: string }>(machine: T): T {
    this.machineIds.add(machine.id);
    return machine;
  }

  forget(machineId: string): void {
    this.machineIds.delete(machineId);
  }

  async cleanup(): Promise<void> {
    for (const machineId of [...this.machineIds]) {
      const machine = this.client.machine(machineId);
      machine.files.unwatch();
      try {
        await machine.delete();
      } catch (error) {
        if (!(error instanceof RoolProblem) || error.status !== 404)
          throw error;
      }
      this.machineIds.delete(machineId);
    }
  }
}

export async function waitForFileTree(
  files: MachineFiles,
  predicate: () => boolean,
  timeoutMs = 15_000,
): Promise<void> {
  if (predicate()) return;

  await new Promise<void>((resolve, reject) => {
    let unsubscribe = () => {};
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error("Timed out waiting for the machine file tree"));
    }, timeoutMs);
    const finish = () => {
      clearTimeout(timeout);
      unsubscribe();
      resolve();
    };

    unsubscribe = files.tree.subscribe(() => {
      if (predicate()) finish();
    });
    if (predicate()) finish();
  });
}

export function runSmokeTest(
  main: () => Promise<void>,
  cleanup: () => Promise<void>,
): void {
  main()
    .then(cleanup)
    .catch(async (error) => {
      console.error(
        "\n❌ FAILED:",
        error instanceof Error ? error.message : error,
      );
      try {
        await cleanup();
      } catch (cleanupError) {
        console.error(
          "Cleanup failed:",
          cleanupError instanceof Error ? cleanupError.message : cleanupError,
        );
      }
      process.exitCode = 1;
    });
}
