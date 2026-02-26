'use strict';

const { createWidget, STATES } = require('../../ui/widget');

describe('createWidget', () => {
  let widget;

  beforeEach(() => {
    // 既存ウィジェットをクリーンアップ
    const existing = document.getElementById('vfa-widget');
    if (existing) existing.remove();
    widget = createWidget();
  });

  afterEach(() => {
    widget.destroy();
  });

  // ──────────────────────────────────────
  // DOM生成
  // ──────────────────────────────────────
  describe('DOM生成', () => {
    test('document.body に #vfa-widget を追加する', () => {
      const el = document.getElementById('vfa-widget');
      expect(el).not.toBeNull();
      expect(document.body.contains(el)).toBe(true);
    });

    test('.vfa-status 要素を持つ', () => {
      const el = document.getElementById('vfa-widget');
      expect(el.querySelector('.vfa-status')).not.toBeNull();
    });

    test('.vfa-transcript 要素を持つ', () => {
      const el = document.getElementById('vfa-widget');
      expect(el.querySelector('.vfa-transcript')).not.toBeNull();
    });

    test('.vfa-message 要素を持つ', () => {
      const el = document.getElementById('vfa-widget');
      expect(el.querySelector('.vfa-message')).not.toBeNull();
    });

    test('.vfa-confirm 要素と はい/いいえ ボタンを持つ', () => {
      const el = document.getElementById('vfa-widget');
      expect(el.querySelector('.vfa-confirm')).not.toBeNull();
      expect(el.querySelector('.vfa-btn-yes')).not.toBeNull();
      expect(el.querySelector('.vfa-btn-no')).not.toBeNull();
    });

    test('role="status" 属性を持つ（アクセシビリティ）', () => {
      const el = document.getElementById('vfa-widget');
      expect(el.getAttribute('role')).toBe('status');
    });

    test('innerHTML を使用しない（XSS防止）', () => {
      const el = document.getElementById('vfa-widget');
      widget.setState(STATES.ERROR, { message: '<script>alert(1)</script>' });
      const messageEl = el.querySelector('.vfa-message');
      // textContent でセットされていれば innerHTML はエスケープされる
      expect(messageEl.textContent).toBe('<script>alert(1)</script>');
      expect(messageEl.innerHTML).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    });
  });

  // ──────────────────────────────────────
  // 初期状態
  // ──────────────────────────────────────
  describe('初期状態', () => {
    test('getState() は idle を返す', () => {
      expect(widget.getState()).toBe(STATES.IDLE);
    });

    test('ウィジェットは非表示', () => {
      const el = document.getElementById('vfa-widget');
      expect(el.style.display).toBe('none');
    });

    test('data-state 属性が idle', () => {
      const el = document.getElementById('vfa-widget');
      expect(el.getAttribute('data-state')).toBe('idle');
    });
  });

  // ──────────────────────────────────────
  // listening 状態
  // ──────────────────────────────────────
  describe('setState(listening)', () => {
    beforeEach(() => {
      widget.setState(STATES.LISTENING);
    });

    test('ウィジェットを表示する', () => {
      const el = document.getElementById('vfa-widget');
      expect(el.style.display).toBe('block');
    });

    test('ステータスに "リスニング中..." を表示する', () => {
      const el = document.getElementById('vfa-widget');
      expect(el.querySelector('.vfa-status').textContent).toBe('リスニング中...');
    });

    test('確認ボタンを非表示にする', () => {
      const el = document.getElementById('vfa-widget');
      expect(el.querySelector('.vfa-confirm').style.display).toBe('none');
    });

    test('getState() は listening を返す', () => {
      expect(widget.getState()).toBe(STATES.LISTENING);
    });

    test('data-state 属性が listening', () => {
      const el = document.getElementById('vfa-widget');
      expect(el.getAttribute('data-state')).toBe('listening');
    });
  });

  // ──────────────────────────────────────
  // processing 状態
  // ──────────────────────────────────────
  describe('setState(processing)', () => {
    test('"処理中..." ステータスでウィジェットを表示する', () => {
      widget.setState(STATES.PROCESSING);
      const el = document.getElementById('vfa-widget');
      expect(el.style.display).toBe('block');
      expect(el.querySelector('.vfa-status').textContent).toBe('処理中...');
    });

    test('transcript オプションがあれば transcript 要素にセットする', () => {
      widget.setState(STATES.PROCESSING, { transcript: 'テスト発話' });
      const el = document.getElementById('vfa-widget');
      expect(el.querySelector('.vfa-transcript').textContent).toBe('テスト発話');
    });

    test('transcript オプションなしでは transcript を変更しない', () => {
      widget.setState(STATES.LISTENING);
      widget.setTranscript('事前テキスト');
      widget.setState(STATES.PROCESSING);
      const el = document.getElementById('vfa-widget');
      // transcript は変えずに保持
      expect(el.querySelector('.vfa-transcript').textContent).toBe('事前テキスト');
    });

    test('getState() は processing を返す', () => {
      widget.setState(STATES.PROCESSING);
      expect(widget.getState()).toBe(STATES.PROCESSING);
    });
  });

  // ──────────────────────────────────────
  // confirm 状態
  // ──────────────────────────────────────
  describe('setState(confirm)', () => {
    let onConfirm;

    beforeEach(() => {
      onConfirm = jest.fn();
      widget.setState(STATES.CONFIRM, {
        message: '田中商事の金額を500万円に変更します。よろしいですか？',
        transcript: '金額を500万に変更して',
        onConfirm,
      });
    });

    test('ウィジェットを表示する', () => {
      const el = document.getElementById('vfa-widget');
      expect(el.style.display).toBe('block');
    });

    test('ステータスに "確認" を表示する', () => {
      const el = document.getElementById('vfa-widget');
      expect(el.querySelector('.vfa-status').textContent).toBe('確認');
    });

    test('確認ボタンを表示する', () => {
      const el = document.getElementById('vfa-widget');
      expect(el.querySelector('.vfa-confirm').style.display).toBe('flex');
    });

    test('message テキストをセットする', () => {
      const el = document.getElementById('vfa-widget');
      expect(el.querySelector('.vfa-message').textContent).toBe(
        '田中商事の金額を500万円に変更します。よろしいですか？'
      );
    });

    test('transcript テキストをセットする', () => {
      const el = document.getElementById('vfa-widget');
      expect(el.querySelector('.vfa-transcript').textContent).toBe('金額を500万に変更して');
    });

    test('はい ボタンクリックで onConfirm(true) を呼ぶ', () => {
      const el = document.getElementById('vfa-widget');
      el.querySelector('.vfa-btn-yes').click();
      expect(onConfirm).toHaveBeenCalledWith(true);
    });

    test('いいえ ボタンクリックで onConfirm(false) を呼ぶ', () => {
      const el = document.getElementById('vfa-widget');
      el.querySelector('.vfa-btn-no').click();
      expect(onConfirm).toHaveBeenCalledWith(false);
    });

    test('getState() は confirm を返す', () => {
      expect(widget.getState()).toBe(STATES.CONFIRM);
    });

    test('onConfirm なしでもクリックしてもエラーにならない', () => {
      widget.setState(STATES.CONFIRM, { message: 'テスト' });
      const el = document.getElementById('vfa-widget');
      expect(() => el.querySelector('.vfa-btn-yes').click()).not.toThrow();
    });
  });

  // ──────────────────────────────────────
  // success 状態
  // ──────────────────────────────────────
  describe('setState(success)', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('"完了" ステータスでウィジェットを表示する', () => {
      widget.setState(STATES.SUCCESS, { message: '田中商事を更新しました' });
      const el = document.getElementById('vfa-widget');
      expect(el.style.display).toBe('block');
      expect(el.querySelector('.vfa-status').textContent).toBe('完了');
    });

    test('message テキストをセットする', () => {
      widget.setState(STATES.SUCCESS, { message: '田中商事を更新しました' });
      const el = document.getElementById('vfa-widget');
      expect(el.querySelector('.vfa-message').textContent).toBe('田中商事を更新しました');
    });

    test('デフォルト3000ms 後に idle へ自動遷移する', () => {
      widget.setState(STATES.SUCCESS, { message: '完了' });
      const el = document.getElementById('vfa-widget');
      expect(el.style.display).toBe('block');
      jest.advanceTimersByTime(3000);
      expect(el.style.display).toBe('none');
      expect(widget.getState()).toBe(STATES.IDLE);
    });

    test('カスタム duration で自動遷移する', () => {
      widget.setState(STATES.SUCCESS, { message: '完了', duration: 1000 });
      const el = document.getElementById('vfa-widget');
      jest.advanceTimersByTime(999);
      expect(el.style.display).toBe('block');
      jest.advanceTimersByTime(1);
      expect(el.style.display).toBe('none');
    });

    test('getState() は success を返す', () => {
      widget.setState(STATES.SUCCESS, { message: '完了' });
      expect(widget.getState()).toBe(STATES.SUCCESS);
    });

    test('確認ボタンを非表示にする', () => {
      widget.setState(STATES.SUCCESS, { message: '完了' });
      const el = document.getElementById('vfa-widget');
      expect(el.querySelector('.vfa-confirm').style.display).toBe('none');
    });
  });

  // ──────────────────────────────────────
  // error 状態
  // ──────────────────────────────────────
  describe('setState(error)', () => {
    test('"エラー" ステータスでウィジェットを表示する', () => {
      widget.setState(STATES.ERROR, { message: '見つかりませんでした' });
      const el = document.getElementById('vfa-widget');
      expect(el.style.display).toBe('block');
      expect(el.querySelector('.vfa-status').textContent).toBe('エラー');
    });

    test('message テキストをセットする', () => {
      widget.setState(STATES.ERROR, { message: '見つかりませんでした' });
      const el = document.getElementById('vfa-widget');
      expect(el.querySelector('.vfa-message').textContent).toBe('見つかりませんでした');
    });

    test('getState() は error を返す', () => {
      widget.setState(STATES.ERROR, { message: 'エラー' });
      expect(widget.getState()).toBe(STATES.ERROR);
    });

    test('確認ボタンを非表示にする', () => {
      widget.setState(STATES.ERROR, { message: 'エラー' });
      const el = document.getElementById('vfa-widget');
      expect(el.querySelector('.vfa-confirm').style.display).toBe('none');
    });
  });

  // ──────────────────────────────────────
  // idle 状態へ戻る
  // ──────────────────────────────────────
  describe('setState(idle)', () => {
    test('listening からウィジェットを非表示にする', () => {
      widget.setState(STATES.LISTENING);
      widget.setState(STATES.IDLE);
      const el = document.getElementById('vfa-widget');
      expect(el.style.display).toBe('none');
    });

    test('status / message / transcript をクリアする', () => {
      widget.setState(STATES.ERROR, { message: 'エラー' });
      widget.setState(STATES.IDLE);
      const el = document.getElementById('vfa-widget');
      expect(el.querySelector('.vfa-status').textContent).toBe('');
      expect(el.querySelector('.vfa-message').textContent).toBe('');
      expect(el.querySelector('.vfa-transcript').textContent).toBe('');
    });

    test('getState() は idle を返す', () => {
      widget.setState(STATES.LISTENING);
      widget.setState(STATES.IDLE);
      expect(widget.getState()).toBe(STATES.IDLE);
    });
  });

  // ──────────────────────────────────────
  // setTranscript
  // ──────────────────────────────────────
  describe('setTranscript', () => {
    test('transcript テキストを更新する', () => {
      widget.setState(STATES.LISTENING);
      widget.setTranscript('田中商事の電話番号を更新して');
      const el = document.getElementById('vfa-widget');
      expect(el.querySelector('.vfa-transcript').textContent).toBe('田中商事の電話番号を更新して');
    });

    test('前の transcript を上書きする', () => {
      widget.setState(STATES.LISTENING);
      widget.setTranscript('最初のテキスト');
      widget.setTranscript('最終テキスト');
      const el = document.getElementById('vfa-widget');
      expect(el.querySelector('.vfa-transcript').textContent).toBe('最終テキスト');
    });
  });

  // ──────────────────────────────────────
  // editing 状態
  // ──────────────────────────────────────
  describe('editing 状態', () => {
    test('setState(editing) → input に keyword が入る', () => {
      widget.setState(STATES.EDITING, { keyword: 'たなか商事', sfObject: 'Account' });
      const el = document.getElementById('vfa-widget');
      const input = el.querySelector('.vfa-edit-input');
      expect(input).not.toBeNull();
      expect(input.value).toBe('たなか商事');
    });

    test('setState(editing) → 指定 sfObject が active になる', () => {
      widget.setState(STATES.EDITING, { keyword: 'テスト', sfObject: 'Opportunity' });
      const el = document.getElementById('vfa-widget');
      const activeBtn = el.querySelector('.vfa-obj-active');
      expect(activeBtn).not.toBeNull();
      expect(activeBtn.getAttribute('data-object')).toBe('Opportunity');
    });

    test('setState(editing) → sfObject 未指定なら Account が active', () => {
      widget.setState(STATES.EDITING, { keyword: 'テスト' });
      const el = document.getElementById('vfa-widget');
      const activeBtn = el.querySelector('.vfa-obj-active');
      expect(activeBtn.getAttribute('data-object')).toBe('Account');
    });

    test('Enter キー → onConfirm(keyword, object) が呼ばれる', () => {
      const onConfirm = jest.fn();
      widget.setState(STATES.EDITING, { keyword: 'テスト', sfObject: 'Account', onConfirm });
      const el = document.getElementById('vfa-widget');
      const input = el.querySelector('.vfa-edit-input');
      input.value = '田中商事';
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      input.dispatchEvent(event);
      expect(onConfirm).toHaveBeenCalledWith('田中商事', 'Account');
    });

    test('空文字で Enter → onConfirm は呼ばれない', () => {
      const onConfirm = jest.fn();
      widget.setState(STATES.EDITING, { keyword: '', sfObject: 'Account', onConfirm });
      const el = document.getElementById('vfa-widget');
      const input = el.querySelector('.vfa-edit-input');
      input.value = '   ';
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      input.dispatchEvent(event);
      expect(onConfirm).not.toHaveBeenCalled();
    });

    test('Escape キー → onCancel が呼ばれる', () => {
      const onCancel = jest.fn();
      widget.setState(STATES.EDITING, { keyword: 'テスト', sfObject: 'Account', onCancel });
      const el = document.getElementById('vfa-widget');
      const input = el.querySelector('.vfa-edit-input');
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      input.dispatchEvent(event);
      expect(onCancel).toHaveBeenCalled();
    });

    test('キャンセルボタン → onCancel が呼ばれる', () => {
      const onCancel = jest.fn();
      widget.setState(STATES.EDITING, { keyword: 'テスト', sfObject: 'Account', onCancel });
      const el = document.getElementById('vfa-widget');
      const cancelBtn = el.querySelector('.vfa-btn-cancel');
      cancelBtn.click();
      expect(onCancel).toHaveBeenCalled();
    });

    test('60秒後 → ERROR → 3秒後 IDLE', () => {
      jest.useFakeTimers();
      widget.setState(STATES.EDITING, { keyword: 'テスト', sfObject: 'Account' });
      expect(widget.getState()).toBe(STATES.EDITING);
      jest.advanceTimersByTime(60000);
      expect(widget.getState()).toBe(STATES.ERROR);
      jest.advanceTimersByTime(3000);
      expect(widget.getState()).toBe(STATES.IDLE);
      jest.useRealTimers();
    });

    test('IDLE 遷移時に edit-row が非表示になる', () => {
      widget.setState(STATES.EDITING, { keyword: 'テスト', sfObject: 'Account' });
      widget.setState(STATES.IDLE);
      const el = document.getElementById('vfa-widget');
      expect(el.querySelector('.vfa-edit-row').style.display).toBe('none');
      expect(el.querySelector('.vfa-object-row').style.display).toBe('none');
      expect(el.querySelector('.vfa-btn-cancel').style.display).toBe('none');
    });

    test('オブジェクトボタンクリックで active が切り替わる', () => {
      widget.setState(STATES.EDITING, { keyword: 'テスト', sfObject: 'Account' });
      const el = document.getElementById('vfa-widget');
      const opportunityBtn = el.querySelector('[data-object="Opportunity"]');
      opportunityBtn.click();
      expect(opportunityBtn.classList.contains('vfa-obj-active')).toBe(true);
      const accountBtn = el.querySelector('[data-object="Account"]');
      expect(accountBtn.classList.contains('vfa-obj-active')).toBe(false);
    });

    test('🔍 ボタンクリック → onConfirm(keyword, object) が呼ばれる', () => {
      const onConfirm = jest.fn();
      widget.setState(STATES.EDITING, { keyword: 'たなか商事', sfObject: 'Account', onConfirm });
      const el = document.getElementById('vfa-widget');
      const input = el.querySelector('.vfa-edit-input');
      input.value = '田中商事';
      el.querySelector('.vfa-btn-search').click();
      expect(onConfirm).toHaveBeenCalledWith('田中商事', 'Account');
    });

    test('getState() は editing を返す', () => {
      widget.setState(STATES.EDITING, { keyword: 'テスト', sfObject: 'Account' });
      expect(widget.getState()).toBe(STATES.EDITING);
    });

    test('data-state 属性が editing', () => {
      widget.setState(STATES.EDITING, { keyword: 'テスト', sfObject: 'Account' });
      const el = document.getElementById('vfa-widget');
      expect(el.getAttribute('data-state')).toBe('editing');
    });
  });

  // ──────────────────────────────────────
  // selecting 状態（候補選択待ち）
  // ──────────────────────────────────────
  describe('setState(selecting)', () => {
    test('"候補を選択" ステータスでウィジェットを表示する', () => {
      widget.setState(STATES.SELECTING, { message: '2件見つかりました。番号で選択してください。' });
      const el = document.getElementById('vfa-widget');
      expect(el.style.display).toBe('block');
      expect(el.querySelector('.vfa-status').textContent).toBe('候補を選択');
    });

    test('message テキストをセットする', () => {
      widget.setState(STATES.SELECTING, { message: '3件見つかりました。番号で選択してください。' });
      const el = document.getElementById('vfa-widget');
      expect(el.querySelector('.vfa-message').textContent).toBe('3件見つかりました。番号で選択してください。');
    });

    test('自動消滅しない（タイマーなし）', () => {
      jest.useFakeTimers();
      widget.setState(STATES.SELECTING, { message: '2件見つかりました。' });
      jest.advanceTimersByTime(30000);
      expect(widget.getState()).toBe(STATES.SELECTING);
      jest.useRealTimers();
    });

    test('getState() は selecting を返す', () => {
      widget.setState(STATES.SELECTING, { message: '2件見つかりました。' });
      expect(widget.getState()).toBe(STATES.SELECTING);
    });

    test('data-state 属性が selecting', () => {
      widget.setState(STATES.SELECTING, { message: '2件見つかりました。' });
      const el = document.getElementById('vfa-widget');
      expect(el.getAttribute('data-state')).toBe('selecting');
    });

    test('確認ボタンを非表示にする', () => {
      widget.setState(STATES.SELECTING, { message: '2件見つかりました。' });
      const el = document.getElementById('vfa-widget');
      expect(el.querySelector('.vfa-confirm').style.display).toBe('none');
    });

    test('selecting から idle へ遷移できる', () => {
      widget.setState(STATES.SELECTING, { message: '2件見つかりました。' });
      widget.setState(STATES.IDLE);
      expect(widget.getState()).toBe(STATES.IDLE);
      const el = document.getElementById('vfa-widget');
      expect(el.style.display).toBe('none');
    });
  });

  // ──────────────────────────────────────
  // destroy
  // ──────────────────────────────────────
  describe('destroy', () => {
    test('DOM からウィジェットを削除する', () => {
      widget.destroy();
      expect(document.getElementById('vfa-widget')).toBeNull();
      // afterEach で再度 destroy されないよう上書き
      widget = { destroy: () => {} };
    });
  });

  // ──────────────────────────────────────
  // 状態遷移
  // ──────────────────────────────────────
  describe('状態遷移', () => {
    test('listening → processing へ遷移できる', () => {
      widget.setState(STATES.LISTENING);
      widget.setState(STATES.PROCESSING, { transcript: 'テスト' });
      expect(widget.getState()).toBe(STATES.PROCESSING);
    });

    test('processing → confirm へ遷移できる', () => {
      widget.setState(STATES.PROCESSING);
      widget.setState(STATES.CONFIRM, { message: '確認', onConfirm: jest.fn() });
      expect(widget.getState()).toBe(STATES.CONFIRM);
    });

    test('success の自動遷移タイマーを error 遷移でキャンセルする', () => {
      jest.useFakeTimers();
      widget.setState(STATES.SUCCESS, { message: '完了', duration: 3000 });
      widget.setState(STATES.ERROR, { message: 'エラー発生' });
      jest.advanceTimersByTime(3000);
      // error のまま → idle に戻らない
      expect(widget.getState()).toBe(STATES.ERROR);
      jest.useRealTimers();
    });

    test('confirm 後に idle へ戻せる', () => {
      widget.setState(STATES.CONFIRM, { message: '確認', onConfirm: jest.fn() });
      widget.setState(STATES.IDLE);
      expect(widget.getState()).toBe(STATES.IDLE);
      const el = document.getElementById('vfa-widget');
      expect(el.querySelector('.vfa-confirm').style.display).toBe('none');
    });
  });
});
