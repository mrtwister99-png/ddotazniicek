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

test('the password is revealed only while the visibility control is held', async () => {
  const login = await readFile(
    new URL('../app/(tabs)/index.tsx', import.meta.url),
    'utf8',
  );

  assert.match(login, /const \[isPasswordVisible, setIsPasswordVisible\] = useState\(false\);/);
  assert.match(login, /secureTextEntry={!isPasswordVisible}/);
  assert.match(login, /accessibilityLabel="Zobrazit heslo podržením"/);
  assert.match(login, /onPressIn=\{\(\) => setIsPasswordVisible\(true\)\}/);
  assert.match(login, /onPressOut=\{\(\) => setIsPasswordVisible\(false\)\}/);
});

test('the login form adjusts to the keyboard on both mobile platforms', async () => {
  const login = await readFile(
    new URL('../app/(tabs)/index.tsx', import.meta.url),
    'utf8',
  );

  assert.match(
    login,
    /behavior=\{Platform\.OS === 'ios' \? 'padding' : 'height'\}/,
  );
});
