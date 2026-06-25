import pkg from '../package.json' with { type: 'json' };

export interface RoolClientIdentity {
  /** Application name, e.g. com.example.app or my-web-app. */
  appName?: string;
  /** Application version, e.g. 1.4.2. */
  appVersion?: string;
  /** Operating system version, e.g. iOS 17.5 or Android 15. */
  osVersion?: string;
}

export interface RoolClientInfo {
  sdkName: string;
  sdkVersion: string;
  identity: RoolClientIdentity;
}

export const roolSdkVersion = pkg.version;

export function resolveClientInfo(identity?: RoolClientIdentity): RoolClientInfo {
  return {
    sdkName: pkg.name,
    sdkVersion: pkg.version,
    identity: identity ?? {},
  };
}

export function addClientInfoHeaders(headers: Headers, clientInfo: RoolClientInfo): void {
  headers.set('X-Rool-SDK-Name', clientInfo.sdkName);
  headers.set('X-Rool-SDK-Version', clientInfo.sdkVersion);

  if (clientInfo.identity.appName) headers.set('X-Rool-App-Name', clientInfo.identity.appName);
  if (clientInfo.identity.appVersion) headers.set('X-Rool-App-Version', clientInfo.identity.appVersion);
  if (clientInfo.identity.osVersion) headers.set('X-Rool-OS-Version', clientInfo.identity.osVersion);
}

export function clientInfoHeaderRecord(clientInfo: RoolClientInfo): Record<string, string> {
  const headers = new Headers();
  addClientInfoHeaders(headers, clientInfo);
  return Object.fromEntries(headers.entries());
}
