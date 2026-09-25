import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { AtomicCaptureFiles } from './semantic-capture.mjs';

test('candidate files become one published PNG/receipt pair only after both writes', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'storytree-semantic-capture-'));
  const png = path.join(dir, 'forest-1.png');
  const json = path.join(dir, 'forest-1.json');
  const files = new AtomicCaptureFiles('test');
  await files.writeCandidate(png, new Uint8Array([1, 2, 3]));
  await files.writeCandidate(json, '{"ok":true}');
  await files.publish(png);
  await assert.rejects(readFile(png), /ENOENT/, 'the first publish call cannot expose half a pair');
  await files.publish(json);
  assert.deepEqual([...await readFile(png)], [1, 2, 3]);
  assert.equal(await readFile(json, 'utf8'), '{"ok":true}');
});

test('candidate cleanup never removes a pre-existing public artifact', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'storytree-semantic-capture-'));
  const png = path.join(dir, 'forest-1.png');
  await writeExisting(png, 'old');
  const files = new AtomicCaptureFiles('test');
  await assert.rejects(files.writeCandidate(png, 'new'), /refusing to overwrite/);
  await files.removeCandidate(png);
  assert.equal(await readFile(png, 'utf8'), 'old');
});

async function writeExisting(file, content) {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(file, content);
}
