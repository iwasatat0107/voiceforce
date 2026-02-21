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
    // デフォルトは Alt+V（Mac: Option+V）。chrome://extensions/shortcuts でカスタマイズ可能
    expect(manifest.commands['toggle-voice'].suggested_key.default).toBe('Alt+V');
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

  // ── CSP（Fix 9） ──────────────────────────────────────────────
  test('content_security_policy が設定されている', () => {
    expect(manifest.content_security_policy).toBeDefined();
    expect(manifest.content_security_policy.extension_pages).toBeDefined();
  });

  test('CSP で unsafe-inline / unsafe-eval が禁止されている', () => {
    const csp = manifest.content_security_policy.extension_pages;
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
  });

  test('CSP に script-src self が含まれている', () => {
    const csp = manifest.content_security_policy.extension_pages;
    expect(csp).toContain("script-src 'self'");
  });
});
