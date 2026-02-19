const manifest = require('../../manifest.json');

describe('manifest.json', () => {
  test('manifest_version は 3', () => {
    expect(manifest.manifest_version).toBe(3);
  });

  test('必須フィールドが存在する', () => {
    expect(manifest.name).toBeDefined();
    expect(manifest.version).toBeDefined();
    expect(manifest.description).toBeDefined();
  });

  test('background.service_worker が設定されている', () => {
    expect(manifest.background.service_worker).toBe('background.js');
  });

  test('content_scripts が Salesforce ドメインに設定されている', () => {
    const matches = manifest.content_scripts[0].matches;
    expect(matches.some(m => m.includes('salesforce.com'))).toBe(true);
    expect(matches.some(m => m.includes('force.com'))).toBe(true);
  });

  test('toggle-voice コマンドが定義されている', () => {
    expect(manifest.commands['toggle-voice']).toBeDefined();
    expect(manifest.commands['toggle-voice'].description).toBe('音声入力のON/OFF切り替え');
    // ショートカットキーはユーザーが chrome://extensions/shortcuts で自由に設定する（デフォルトなし）
    expect(manifest.commands['toggle-voice'].suggested_key).toBeUndefined();
  });

  test('permissions に必要なものが含まれている', () => {
    expect(manifest.permissions).toContain('activeTab');
    expect(manifest.permissions).toContain('storage');
    expect(manifest.permissions).toContain('identity');
  });

  test('host_permissions に Salesforce ドメインが含まれている', () => {
    const hp = manifest.host_permissions;
    expect(hp.some(h => h.includes('salesforce.com'))).toBe(true);
  });
});
