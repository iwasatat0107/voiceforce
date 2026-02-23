const path = require('path');
const fs   = require('fs');
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

  // ── content_scripts 整合性（再発防止: インシデント #2 教訓） ──────────────────
  //
  // 背景: manifest.json の content_scripts に新スクリプトを追加したが
  //       動作確認手順（ビルド→拡張機能リロード→タブリロード）が漏れ、
  //       Option+V が無反応になるインシデントが 2026-02-23 に発生した。
  //
  // このテスト群は「content.js が依存するグローバル関数の提供元ファイルが
  // content_scripts に全て列挙されているか」を自動で検証し、追加漏れを CI で検知する。

  describe('content_scripts 整合性', () => {
    const scripts = manifest.content_scripts[0].js;

    test('content.js が content_scripts の最後に記載されている', () => {
      expect(scripts[scripts.length - 1]).toBe('content.js');
    });

    test('全 content_scripts ファイルがソースディレクトリに存在する', () => {
      const root = path.resolve(__dirname, '../../');
      for (const script of scripts) {
        const srcPath = path.join(root, script);
        expect(fs.existsSync(srcPath)).toBe(true);
      }
    });

    // content.js が // eslint-disable-line no-undef で参照するグローバル関数と
    // その提供元ファイルの対応表。新しいグローバル依存を追加したら必ずここも更新する。
    const REQUIRED_PROVIDERS = {
      'lib/ruleEngine.js':         'match()',
      'lib/navigator.js':          'navigateTo() / buildListUrl() / buildRecordUrl() / goBack()',
      'lib/speechRecognition.js':  'createSpeechRecognition()',
      'lib/salesforceApi.js':      'sosl()',
      'lib/recordResolver.js':     'resolve()',
      'ui/widget.js':              'createWidget()',
      'ui/candidateList.js':       'createCandidateList()',
    };

    test.each(Object.entries(REQUIRED_PROVIDERS))(
      'content.js の依存 %s (%s) が content_scripts に含まれている',
      (file) => {
        expect(scripts).toContain(file);
      }
    );
  });
});
