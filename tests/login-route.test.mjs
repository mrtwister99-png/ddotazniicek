import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the login route is not wrapped in the starter tab navigator', async () => {
  const layout = await readFile(
    new URL('../app/(tabs)/_layout.tsx', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(layout, /<Tabs(?:\s|>)/);
});
