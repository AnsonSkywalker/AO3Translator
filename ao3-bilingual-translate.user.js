// ==UserScript==
// @name         AO3 Bilingual Translator (DeepSeek)
// @namespace    https://github.com/ao3-bilingual
// @version      1.1.0
// @description  使用 DeepSeek LLM 自动翻译 AO3 作品，段落交替双语对照显示
// @author       Reasonix
// @match        https://archiveofourown.org/works/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_deleteValue
// @connect      *
// ==/UserScript==

(function () {
  'use strict';

  // ==================== 常量 ====================
  const API_URL = 'https://api.deepseek.com/chat/completions';
  const DEFAULT_MODEL = 'deepseek-v4-flash';
  const PARA_DELIMITER = '\n\n<<<AO3_PARA_BREAK>>>\n\n';
  const BATCH_SIZE = 1;          // 每批 1 段（逐段调 API，无需拆分，100% 可靠）
  const CONTEXT_BEFORE = 2;      // 前文段落数（上下文窗口）
  const CONTEXT_AFTER = 1;       // 后文段落数（帮助 LLM 预判后续内容）

  // ==================== 状态 ====================
  let isTranslating = false;
  let hasTranslated = false;        // 当前页面是否已完成过翻译
  let translationsVisible = false;  // 翻译段落当前是否可见
  let translationData = [];         // 存储翻译结果，用于 toggle

  // ==================== 样式注入 ====================
  GM_addStyle(`
    /* ---- 浮动按钮 ---- */
    #ao3-translate-btn {
      position: fixed;
      bottom: 28px;
      right: 28px;
      z-index: 9999;
      width: 52px;
      height: 52px;
      border-radius: 50%;
      border: none;
      background: #1a1a2e;
      color: #e0e0e0;
      font-size: 22px;
      cursor: pointer;
      box-shadow: 0 4px 16px rgba(0,0,0,.25);
      transition: transform .2s, box-shadow .2s, background .2s;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    #ao3-translate-btn:hover {
      transform: scale(1.08);
      box-shadow: 0 6px 24px rgba(0,0,0,.35);
      background: #16213e;
    }
    #ao3-translate-btn:active {
      transform: scale(.95);
    }
    #ao3-translate-btn.translating {
      background: #e94560;
      animation: ao3-pulse .8s infinite alternate;
    }
    @keyframes ao3-pulse {
      from { box-shadow: 0 4px 16px rgba(233,69,96,.4); }
      to   { box-shadow: 0 4px 28px rgba(233,69,96,.8); }
    }

    /* ---- 进度条 ---- */
    #ao3-progress-bar-wrap {
      position: fixed;
      top: 0; left: 0; right: 0;
      height: 4px;
      z-index: 10000;
      background: transparent;
      pointer-events: none;
    }
    #ao3-progress-bar {
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, #e94560, #0f3460);
      transition: width .3s ease;
    }

    /* ---- 翻译段落样式 ---- */
    p.ao3-trans-para {
      border-left: 3px solid #e94560 !important;
      padding-left: 14px !important;
      margin-left: 4px !important;
      color: #2c3e50 !important;
      background: #fdf2f4 !important;
      border-radius: 0 4px 4px 0 !important;
    }

    /* ---- 设置面板 ---- */
    #ao3-settings-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,.5);
      z-index: 10001;
      align-items: center;
      justify-content: center;
    }
    #ao3-settings-overlay.open {
      display: flex;
    }
    #ao3-settings-panel {
      background: #fff;
      border-radius: 12px;
      padding: 28px 24px;
      width: 420px;
      max-width: 90vw;
      box-shadow: 0 8px 40px rgba(0,0,0,.3);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    #ao3-settings-panel h2 {
      margin: 0 0 20px;
      font-size: 20px;
      color: #1a1a2e;
    }
    #ao3-settings-panel label {
      display: block;
      font-size: 13px;
      font-weight: 600;
      color: #555;
      margin-bottom: 4px;
    }
    #ao3-settings-panel input,
    #ao3-settings-panel select {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid #ddd;
      border-radius: 6px;
      font-size: 14px;
      margin-bottom: 14px;
      box-sizing: border-box;
      font-family: inherit;
    }
    #ao3-settings-panel input:focus,
    #ao3-settings-panel select:focus {
      outline: none;
      border-color: #e94560;
      box-shadow: 0 0 0 3px rgba(233,69,96,.12);
    }
    .ao3-settings-btns {
      display: flex;
      gap: 10px;
      justify-content: flex-end;
      margin-top: 6px;
    }
    .ao3-settings-btns button {
      padding: 10px 20px;
      border: none;
      border-radius: 6px;
      font-size: 14px;
      cursor: pointer;
      font-weight: 600;
    }
    .ao3-settings-btns .btn-primary {
      background: #e94560;
      color: #fff;
    }
    .ao3-settings-btns .btn-primary:hover { background: #d63850; }
    .ao3-settings-btns .btn-ghost {
      background: transparent;
      color: #888;
    }
    .ao3-settings-btns .btn-ghost:hover { color: #555; }

    /* ---- Toast ---- */
    #ao3-toast {
      position: fixed;
      bottom: 90px;
      right: 28px;
      z-index: 10002;
      background: #1a1a2e;
      color: #fff;
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 14px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      opacity: 0;
      transform: translateY(10px);
      transition: opacity .3s, transform .3s;
      pointer-events: none;
    }
    #ao3-toast.show {
      opacity: 1;
      transform: translateY(0);
    }
    #ao3-toast.error { background: #c0392b; }

    /* ---- 小齿轮 ---- */
    #ao3-settings-gear {
      position: fixed;
      bottom: 88px;
      right: 30px;
      z-index: 9998;
      width: 24px;
      height: 24px;
      cursor: pointer;
      opacity: .35;
      transition: opacity .2s;
      font-size: 16px;
      background: none;
      border: none;
      color: #555;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    #ao3-settings-gear:hover { opacity: .8; }
  `);

  // ==================== 设置管理 ====================
  function getApiKey() {
    return GM_getValue('ao3_deepseek_key', '');
  }

  function setApiKey(key) {
    GM_setValue('ao3_deepseek_key', key);
  }

  function getModel() {
    return GM_getValue('ao3_deepseek_model', DEFAULT_MODEL);
  }

  function setModel(model) {
    GM_setValue('ao3_deepseek_model', model);
  }

  // ==================== Toast ====================
  let toastTimer;

  function showToast(msg, isError = false) {
    let el = document.getElementById('ao3-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ao3-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = isError ? 'show error' : 'show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = ''; }, 3000);
  }

  // ==================== 进度条 ====================
  function ensureProgressBar() {
    let wrap = document.getElementById('ao3-progress-bar-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'ao3-progress-bar-wrap';
      wrap.innerHTML = '<div id="ao3-progress-bar"></div>';
      document.body.appendChild(wrap);
    }
    return document.getElementById('ao3-progress-bar');
  }

  function setProgress(pct) {
    const bar = ensureProgressBar();
    bar.style.width = Math.min(100, Math.max(0, pct)) + '%';
  }

  function hideProgress() {
    const wrap = document.getElementById('ao3-progress-bar-wrap');
    if (wrap) setTimeout(() => { if (wrap) wrap.remove(); }, 500);
  }

  // ==================== 设置面板 ====================
  function ensureSettingsOverlay() {
    if (document.getElementById('ao3-settings-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'ao3-settings-overlay';
    overlay.innerHTML = `
      <div id="ao3-settings-panel">
        <h2>⚙️ 翻译设置</h2>
        <label for="ao3-apikey-input">DeepSeek API Key</label>
        <input id="ao3-apikey-input" type="password" placeholder="sk-..." />
        <label for="ao3-model-input">模型</label>
        <select id="ao3-model-input">
          <option value="deepseek-v4-flash">deepseek-v4-flash（快速，推荐）</option>
          <option value="deepseek-v4-pro">deepseek-v4-pro（高质量）</option>
          <option value="deepseek-chat">deepseek-chat（V3，旧）</option>
          <option value="deepseek-reasoner">deepseek-reasoner（R1，旧）</option>
        </select>
        <div class="ao3-settings-btns">
          <button class="btn-ghost" id="ao3-settings-clear">清除记录</button>
          <button class="btn-ghost" id="ao3-settings-test">测试连接</button>
          <button class="btn-primary" id="ao3-settings-save">保存</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // 事件绑定
    document.getElementById('ao3-settings-save').addEventListener('click', () => {
      const key = document.getElementById('ao3-apikey-input').value.trim();
      const model = document.getElementById('ao3-model-input').value;
      if (key) setApiKey(key);
      setModel(model);
      overlay.classList.remove('open');
      showToast('✅ 设置已保存');
    });

    document.getElementById('ao3-settings-clear').addEventListener('click', () => {
      GM_deleteValue('ao3_deepseek_key');
      GM_deleteValue('ao3_deepseek_model');
      document.getElementById('ao3-apikey-input').value = '';
      document.getElementById('ao3-model-input').value = DEFAULT_MODEL;
      overlay.classList.remove('open');
      showToast('🗑️ 设置已清除');
    });

    document.getElementById('ao3-settings-test').addEventListener('click', () => {
      const key = document.getElementById('ao3-apikey-input').value.trim();
      if (!key) {
        showToast('⚠️ 请先输入 API Key', true);
        return;
      }
      const testBtn = document.getElementById('ao3-settings-test');
      testBtn.textContent = '测试中…';
      testBtn.disabled = true;

      console.log('[AO3 Translator] 开始连接测试…');
      GM_xmlhttpRequest({
        method: 'POST',
        url: API_URL,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + key,
        },
        data: JSON.stringify({
          model: document.getElementById('ao3-model-input').value || getModel(),
          messages: [
            { role: 'user', content: 'Say "OK"' },
          ],
          max_tokens: 10,
        }),
        timeout: 15000,
        onload: function (resp) {
          testBtn.textContent = '测试连接';
          testBtn.disabled = false;
          console.log('[AO3 Translator] 测试响应 status:', resp.status, 'body:', (resp.responseText || '').slice(0, 200));
          if (resp.status >= 200 && resp.status < 300) {
            showToast('✅ 连接成功！API 工作正常');
          } else {
            let detail = resp.responseText || '';
            try {
              const d = JSON.parse(detail);
              detail = d.error?.message || d.message || detail;
            } catch (_) {}
            showToast('❌ 服务器返回错误 (' + resp.status + '): ' + detail.slice(0, 150), true);
          }
        },
        onerror: function (resp) {
          testBtn.textContent = '测试连接';
          testBtn.disabled = false;
          console.error('[AO3 Translator] 测试连接失败，完整响应:', JSON.stringify(resp, null, 2));
          let msg = '❌ 无法连接到 DeepSeek API';
          if (resp && resp.status) {
            msg += ' (HTTP ' + resp.status + ')';
          }
          msg += '。请在浏览器控制台 (F12) 查看详细错误。';
          showToast(msg, true);
        },
        ontimeout: function () {
          testBtn.textContent = '测试连接';
          testBtn.disabled = false;
          showToast('❌ 连接超时，请检查网络或防火墙', true);
        },
      });
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('open');
    });
  }

  function openSettings() {
    ensureSettingsOverlay();
    document.getElementById('ao3-apikey-input').value = getApiKey();
    document.getElementById('ao3-model-input').value = getModel();
    document.getElementById('ao3-settings-overlay').classList.add('open');
  }

  // ==================== 按钮 ====================
  function ensureTranslateButton() {
    if (document.getElementById('ao3-translate-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'ao3-translate-btn';
    btn.title = '翻译本章内容';
    btn.innerHTML = '🌐';
    btn.addEventListener('click', onTranslateClick);
    document.body.appendChild(btn);

    // 小齿轮
    const gear = document.createElement('button');
    gear.id = 'ao3-settings-gear';
    gear.title = '翻译设置';
    gear.innerHTML = '⚙';
    gear.addEventListener('click', openSettings);
    document.body.appendChild(gear);
  }

  // ==================== 提取文本 ====================
  function normalizeParagraphs(userstuff) {
    // AO3 常把整章塞进一个 <p>，用 <br><br> 分隔视觉段落。
    // 此函数在 DOM 层面按 <br><br> 拆分，使每个视觉段落成为独立的 <p>。
    const allPElements = Array.from(userstuff.querySelectorAll('p'));
    let splitCount = 0;

    for (const originalP of allPElements) {
      const fragments = [];     // 每个 fragment: 一组连续 DOM 节点
      let current = [];         // 当前积累的节点
      let brQueue = [];         // 暂存的 <br> + 空白文本（可能组成双 <br>）

      for (const node of originalP.childNodes) {
        const isBR = node.nodeType === Node.ELEMENT_NODE && node.tagName === 'BR';
        const isWS  = node.nodeType === Node.TEXT_NODE && node.textContent.trim() === '';

        if (isBR) {
          if (brQueue.length > 0) {
            // 连续两个 <br>（中间可能夹空白）→ 段落边界
            fragments.push(current);
            current = [];
            brQueue = [];
          } else {
            // 第一个 <br>，暂存等待判断是单还是双
            brQueue.push(node);
          }
        } else if (isWS && brQueue.length > 0) {
          // <br> 后面的空白文本，可能是双 <br> 的分隔
          brQueue.push(node);
        } else {
          // 普通内容节点
          if (brQueue.length > 0) {
            // 前面的 <br> 是单换行 → 保留
            current.push(...brQueue);
            brQueue = [];
          }
          current.push(node);
        }
      }
      // 处理末尾残留的 <br>
      if (brQueue.length > 0) {
        current.push(...brQueue);
      }
      if (current.length > 0 || fragments.length === 0) {
        fragments.push(current);
      }

      // 只有一个 fragment → 无需拆分
      if (fragments.length <= 1) continue;

      // 创建新的 <p> 元素
      console.log('[AO3 Translator] 拆分 <p>：', fragments.length, '个视觉段落（原文有双 <br>）');
      splitCount += fragments.length - 1;
      const parent = originalP.parentNode;
      for (const frag of fragments) {
        const newP = document.createElement('p');
        // 复制原 <p> 的属性
        for (const attr of originalP.attributes) {
          newP.setAttribute(attr.name, attr.value);
        }
        // 附加节点
        for (const node of frag) {
          newP.appendChild(node.cloneNode(true));
        }
        parent.insertBefore(newP, originalP);
      }
      parent.removeChild(originalP);
    }

    if (splitCount > 0) {
      console.log('[AO3 Translator] normalizeParagraphs：共拆分了', splitCount, '个双 <br>');
    }
  }

  function getParagraphs() {
    let userstuffs = [];
    const chapterUserstuffs = document.querySelectorAll('#chapters .userstuff');
    if (chapterUserstuffs.length > 0) {
      for (const u of chapterUserstuffs) {
        if (u.offsetParent !== null) {
          userstuffs.push(u);
        }
      }
      if (userstuffs.length === 0) {
        userstuffs = [chapterUserstuffs[0]];
      }
    } else {
      const u = document.querySelector('.userstuff');
      if (u) userstuffs = [u];
    }

    if (userstuffs.length === 0) return [];

    // 预处理：将 <br><br> 拆分为独立 <p>
    for (const us of userstuffs) {
      normalizeParagraphs(us);
    }

    const paras = [];
    for (const userstuff of userstuffs) {
      for (const child of userstuff.children) {
        if (child.tagName === 'P') {
          const text = child.textContent.trim();
          if (text.length > 0) {
            paras.push({ el: child, text: text });
          }
        }
      }
    }

    console.log('[AO3 Translator] getParagraphs：找到', paras.length, '个视觉段落');
    return paras;
  }

  // ==================== 翻译逻辑 ====================
  function buildTranslationPrompt(paragraphs, contextBefore, contextAfter) {
    // paragraphs: 待翻译段落数组 [{el, text}]（BATCH_SIZE=1 时长度为 1）
    // contextBefore: 前文原文数组（帮助 LLM 理解上文）
    // contextAfter:  后文原文数组（帮助 LLM 预判下文，不翻译）
    const texts = paragraphs.map(p => p.text);
    const parts = [];

    if (contextBefore && contextBefore.length > 0) {
      parts.push('[前文原文（已翻译，仅供参考上下文）]\n' + contextBefore.join('\n---\n'));
    }

    parts.push('[待翻译]\n' + texts.join('\n\n---\n\n'));

    if (contextAfter && contextAfter.length > 0) {
      parts.push('[后文原文（仅供参考上下文，请勿翻译）]\n' + contextAfter.join('\n---\n'));
    }

    const userText = parts.join('\n\n');

    const systemPrompt = `你是一位资深文学翻译。请将 [待翻译] 中的英文小说/同人作品翻译成简体中文。

翻译原则：
- 保持原文的风格、语气和情感色彩
- 文学性优先：使用自然流畅的中文，避免生硬直译
- 对话要口语化、符合人物性格
- 注意与前文和后文的连贯性（代词指代、情节延续、专有名词统一）
- 专有名词（人名、地名）保持前后一致
- 保留原文的强调标记（如斜体用书名号《》标示）
- 只翻译 [待翻译] 中的内容，不要翻译 [前文原文] 和 [后文原文]
- 只输出翻译结果，不要任何解释、注释或额外文字`;

    return { systemPrompt, userText };
  }

  function translateChunk(paragraphs, contextBefore, contextAfter) {
    return new Promise((resolve, reject) => {
      const apiKey = getApiKey();
      if (!apiKey) {
        reject(new Error('请先设置 DeepSeek API Key（点击翻译按钮旁的小齿轮 ⚙）'));
        return;
      }

      const { systemPrompt, userText } = buildTranslationPrompt(paragraphs, contextBefore, contextAfter);
      const tStart = performance.now();

      GM_xmlhttpRequest({
        method: 'POST',
        url: API_URL,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey,
        },
        data: JSON.stringify({
          model: getModel(),
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userText },
          ],
          temperature: 0.3,
          max_tokens: 8192,
        }),
        timeout: 120000,
        onload: function (resp) {
          const elapsed = (performance.now() - tStart).toFixed(0);

          if (resp.status < 200 || resp.status >= 300) {
            let detail = resp.responseText || '';
            try {
              const errData = JSON.parse(detail);
              detail = errData.error?.message || errData.message || detail;
            } catch (_) {}
            if (detail.length > 300) detail = detail.slice(0, 300) + '…';
            console.warn('[AO3 Translator] ✗ HTTP', resp.status, '|', elapsed + 'ms');
            reject(new Error(`API 返回错误 (HTTP ${resp.status}): ${detail}`));
            return;
          }

          try {
            const data = JSON.parse(resp.responseText);
            if (data.error) {
              console.warn('[AO3 Translator] ✗ API error |', elapsed + 'ms');
              reject(new Error('API 错误: ' + (data.error.message || JSON.stringify(data.error))));
              return;
            }
            const translatedText = data.choices?.[0]?.message?.content?.trim();
            if (!translatedText) {
              console.warn('[AO3 Translator] ✗ 空响应 |', elapsed + 'ms');
              reject(new Error('API 返回为空，请检查 API Key 是否有效'));
              return;
            }
            const translatedParas = [translatedText];
            const tokensUsed = data.usage?.total_tokens || '?';
            console.log('[AO3 Translator] ✓', elapsed + 'ms',
              '| 入', userText.length, '字 → 出', translatedText.length, '字',
              '| tokens:', tokensUsed);
            resolve(translatedParas);
          } catch (e) {
            console.warn('[AO3 Translator] ✗ 解析失败 |', elapsed + 'ms');
            reject(new Error('解析 API 返回失败: ' + e.message));
          }
        },
        onerror: function (resp) {
          const elapsed = (performance.now() - tStart).toFixed(0);
          console.error('[AO3 Translator] ✗ 网络错误 |', elapsed + 'ms',
            '|', resp ? ('HTTP ' + (resp.status || '?') + ' ' + (resp.statusText || '')) : '');
          let detail = '';
          if (resp) {
            detail = `HTTP ${resp.status || '?'} ${resp.statusText || ''}`;
            if (resp.responseText) {
              const txt = resp.responseText.slice(0, 200);
              detail += ` — ${txt}`;
            }
          }
          reject(new Error('网络请求失败' + (detail ? ': ' + detail : '，请检查网络连接或防火墙设置')));
        },
        ontimeout: function () {
          const elapsed = (performance.now() - tStart).toFixed(0);
          console.warn('[AO3 Translator] ✗ 超时 |', elapsed + 'ms');
          reject(new Error('请求超时（120秒），请检查网络或稍后重试'));
        },
      });
    });
  }

  async function translateAllIncremental(allParagraphs, onBatchDone) {
    const total = allParagraphs.length;
    const allResults = [];
    const tOverall = performance.now();
    const model = getModel();

    console.log(
      '══════════════════════════════════════\n' +
      '[AO3 Translator] 开始翻译\n' +
      '  模型:    ' + model + '\n' +
      '  总段数:  ' + total + '\n' +
      '  批次:    ' + BATCH_SIZE + ' 段/次\n' +
      '  前文:    ' + CONTEXT_BEFORE + ' 段  后文: ' + CONTEXT_AFTER + ' 段\n' +
      '══════════════════════════════════════'
    );

    for (let i = 0; i < total; i++) {
      const chunk = [allParagraphs[i]];

      // 确定前后文窗口
      const beforeStart = Math.max(0, i - CONTEXT_BEFORE);
      const contextBefore = allParagraphs.slice(beforeStart, i).map(p => p.text);

      const afterEnd = Math.min(total, i + 1 + CONTEXT_AFTER);
      const contextAfter = allParagraphs.slice(i + 1, afterEnd).map(p => p.text);

      try {
        const results = await translateChunk(chunk,
          contextBefore.length > 0 ? contextBefore : null,
          contextAfter.length > 0 ? contextAfter : null
        );

        const batchResults = [];
        for (let j = 0; j < chunk.length; j++) {
          const item = {
            original: chunk[j],
            translation: j < results.length ? results[j] : '[翻译缺失]',
          };
          batchResults.push(item);
          allResults.push(item);
        }

        insertTranslations(batchResults);

        if (onBatchDone) {
          onBatchDone({
            batchIndex: i,
            totalBatches: total,
            batchResults: batchResults,
            totalParagraphs: total,
            doneParagraphs: allResults.length,
          });
        }
      } catch (err) {
        const batchResults = [];
        for (const p of chunk) {
          const item = { original: p, translation: '[翻译失败: ' + err.message + ']' };
          batchResults.push(item);
          allResults.push(item);
        }
        insertTranslations(batchResults);

        if (onBatchDone) {
          onBatchDone({
            batchIndex: i,
            totalBatches: total,
            batchResults: batchResults,
            totalParagraphs: total,
            doneParagraphs: allResults.length,
            error: err.message,
          });
        }
      }
    }

    const totalSec = ((performance.now() - tOverall) / 1000).toFixed(1);
    const avgSec = ((performance.now() - tOverall) / total / 1000).toFixed(1);
    console.log(
      '══════════════════════════════════════\n' +
      '[AO3 Translator] 翻译完成\n' +
      '  总耗时:  ' + totalSec + 's\n' +
      '  平均:    ' + avgSec + 's/段\n' +
      '  成功:    ' + allResults.filter(r => !r.translation.startsWith('[翻译失败')).length + '/' + total + '\n' +
      '══════════════════════════════════════'
    );

    return allResults;
  }

  // ==================== 显示翻译 ====================
  function insertTranslations(results) {
    for (const item of results) {
      // 检查是否已经插入过
      if (item.original.el.nextElementSibling?.classList?.contains('ao3-trans-para')) {
        continue;
      }

      const transP = document.createElement('p');
      transP.className = 'ao3-trans-para';
      transP.textContent = item.translation;

      // 在原文段落后面插入
      item.original.el.insertAdjacentElement('afterend', transP);
    }
  }

  function removeTranslations() {
    document.querySelectorAll('p.ao3-trans-para').forEach(el => el.remove());
  }

  // ==================== 主流程 ====================
  async function onTranslateClick() {
    if (isTranslating) {
      showToast('⏳ 翻译进行中，请稍候...');
      return;
    }

    // 如果已经翻译过，切换显示/隐藏
    if (hasTranslated) {
      if (translationsVisible) {
        removeTranslations();
        translationsVisible = false;
        const btn = document.getElementById('ao3-translate-btn');
        if (btn) btn.innerHTML = '🌐';
        showToast('翻译已隐藏，再次点击显示');
      } else {
        insertTranslations(translationData);
        translationsVisible = true;
        const btn = document.getElementById('ao3-translate-btn');
        if (btn) btn.innerHTML = '👁';
        showToast('翻译已显示');
      }
      return;
    }

    // 首次翻译
    const paragraphs = getParagraphs();
    if (paragraphs.length === 0) {
      showToast('⚠️ 未找到可翻译的段落内容', true);
      return;
    }

    isTranslating = true;
    const btn = document.getElementById('ao3-translate-btn');
    if (btn) {
      btn.classList.add('translating');
      btn.innerHTML = '⏳';
    }

    setProgress(0);
    showToast(`📖 正在翻译 ${paragraphs.length} 个段落...`);

    try {
      translationData = await translateAllIncremental(paragraphs, (info) => {
        // 每批翻译完成后更新进度
        setProgress(Math.round((info.doneParagraphs / info.totalParagraphs) * 100));
        if (info.error) {
          showToast(`⚠️ 第 ${info.batchIndex + 1}/${info.totalBatches} 批出错: ${info.error}`, true);
        } else {
          showToast(`📝 已翻译 ${info.doneParagraphs}/${info.totalParagraphs} 段`);
        }
      });

      hasTranslated = true;
      translationsVisible = true;

      if (btn) {
        btn.classList.remove('translating');
        btn.innerHTML = '👁';
      }
      setProgress(100);
      hideProgress();
      showToast(`✅ 翻译完成！共 ${translationData.length} 段`);
    } catch (err) {
      if (btn) {
        btn.classList.remove('translating');
        btn.innerHTML = '🌐';
      }
      hideProgress();
      showToast('❌ ' + err.message, true);
    } finally {
      isTranslating = false;
    }
  }

  // ==================== 初始化 ====================
  function init() {
    ensureTranslateButton();
    ensureSettingsOverlay();

    // 首次使用提示
    if (!getApiKey()) {
      setTimeout(() => {
        showToast('👋 首次使用？点击 ⚙ 设置 DeepSeek API Key');
      }, 1500);
    }
  }

  // 页面加载完成后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
