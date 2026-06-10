import assert from 'node:assert/strict';
import test from 'node:test';
import { machinePath, machineUri } from '../src/path.js';

test('machinePath is the one decoded absolute path form', () => {
  assert.equal(machinePath('/rool-drive/docs/read%20me.md'), '/rool-drive/docs/read me.md');
  assert.equal(machinePath('rool-machine:/space/note/target.json'), '/space/note/target.json');
  assert.equal(machinePath('rool-machine%3A/space/note/target.json'), '/space/note/target.json');
  assert.equal(machinePath('/space/sp_123/rool-drive/docs/readme.md', { spaceId: 'sp_123' }), '/rool-drive/docs/readme.md');
  assert.equal(machinePath('/dav/sp_123/docs/readme.md', { spaceId: 'sp_123' }), '/rool-drive/docs/readme.md');
});

test('machineUri serializes machine paths for prompts/history', () => {
  assert.equal(machineUri('/rool-drive/docs/read me.md'), 'rool-machine:/rool-drive/docs/read%20me.md');
});
