import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { NodeAuthProvider } from '../src/auth-node.js';

function writeCredentials(filePath: string): void {
  fs.writeFileSync(filePath, JSON.stringify({
    access_token: 'token',
    refresh_token: null,
    rool_token: null,
    expires_at: Date.now() + 3600_000,
  }));
}

test('logout reaches the injected auth-state handler', () => {
  const credentialsPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rool-auth-')), 'credentials.json');
  writeCredentials(credentialsPath);

  const provider = new NodeAuthProvider({ credentialsPath });
  const events: boolean[] = [];
  provider.setAuthStateChangedHandler((authenticated) => events.push(authenticated));

  provider.logout();

  assert.deepEqual(events, [false]);
  assert.equal(fs.existsSync(credentialsPath), false);
});

test('repeated logout notifies only once', () => {
  const credentialsPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rool-auth-')), 'credentials.json');
  writeCredentials(credentialsPath);

  const provider = new NodeAuthProvider({ credentialsPath });
  const events: boolean[] = [];
  provider.setAuthStateChangedHandler((authenticated) => events.push(authenticated));

  provider.logout();
  provider.logout();

  assert.deepEqual(events, [false]);
});
