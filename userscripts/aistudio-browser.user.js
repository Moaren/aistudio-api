// ==UserScript==
// @name         AI Studio 本机临时页接单
// @version      1.3.1
// @updateURL    none
// @downloadURL  none
// @description  将一个明确配对的临时聊天页连接到本机酒馆代理
// @match        https://aistudio.google.com/*
// @noframes
// @connect      127.0.0.1
// @grant        GM_xmlhttpRequest
// @grant        GM_getTab
// @grant        GM_saveTab
// @grant        GM_registerMenuCommand
// ==/UserScript==
(() => {
    'use strict';
    const endpoint = 'http://127.0.0.1:8090/browser/pulse';
    const page = crypto.randomUUID();
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const visible = el => el && el.getClientRects().length > 0;
    const one = selector => [...document.querySelectorAll(selector)].find(visible);
    const editor = () => one('textarea[aria-label="Enter a prompt"], ms-prompt-box textarea');
    const runButton = () => one('ms-run-button button');
    const label = el => (el?.getAttribute('aria-label') || el?.innerText || '').trim();
    const canRun = el => /^(Run\b|运行|執行)/i.test(label(el));
    const isStop = el => /^(Stop\b|停止)/i.test(label(el));
    const model = () => {
        const value = one('ms-model-selector .model-selector-card .subtitle')?.textContent.trim();
        return /^[a-zA-Z0-9._-]{1,128}$/.test(value || '') ? value : '';
    };
    const temporary = () => /^\/(?:u\/\d+\/)?prompts\/new_chat\/?$/.test(location.pathname)
        && new URLSearchParams(location.search).get('temporary') === 'true';
    const key = 'localPlaygroundRelay';
    let pairing;
    let used = false;
    let active = false;
    let paused = false;
    let connection = '尚未连接';
    let renderStatus = () => {};
    const born = Date.now();
    let catalogue;
    let scanAfter = 0;
    const carousel = () => one('mat-dialog-container ms-model-carousel.in-model-selector');

    function choices(menu) {
        const result = new Map();
        for (const button of menu.querySelectorAll('ms-model-carousel-row button.content-button')) {
            const id = button.querySelector('.model-subtitle')?.textContent.trim() || '';
            if (!visible(button) || button.disabled || button.getAttribute('aria-disabled') === 'true'
                || button.querySelector('.badge.paid') || !/^(gemini|gemma)-[a-z0-9._-]+$/i.test(id)
                || /(?:^|-)(?:image|tts|live|transcribe|omni|banana|decision|streaming)(?:-|$)/i.test(id)) continue;
            result.set(id, button);
        }
        return result;
    }

    async function waitFor(read, ms = 4000) {
        const end = Date.now() + ms;
        do {
            const value = read();
            if (value) return value;
            await sleep(100);
        } while (Date.now() < end);
        return null;
    }

    async function inspectMenu(target) {
        if (!active || status() !== 'ready' || one('mat-dialog-container')) {
            throw new Error('请先关闭网页弹窗并确认专用页空闲');
        }
        one('ms-model-selector button.model-selector-card')?.click();
        const menu = await waitFor(carousel);
        if (!menu) throw new Error('未找到网页模型选择器');
        try {
            const chips = [...menu.querySelectorAll('button[variant="filter-chip"]')];
            const all = chips.find(b => /^(All|全部|所有)$/i.test(b.textContent.trim()));
            const families = chips.filter(b => /^(Gemini|Gemma)$/i.test(b.textContent.trim()));
            const family = families.find(b => target?.startsWith(b.textContent.trim().toLowerCase() + '-'));
            const filters = [...new Set(target ? [family, all] : [all, ...families])].filter(Boolean);
            const found = new Set();
            let button;
            // The "All" tab can omit entries present in the Gemini and Gemma categories.
            for (const filter of filters.length ? filters : [null]) {
                if (filter) {
                    filter.click();
                    await sleep(150);
                }
                await waitFor(() => menu.querySelector('ms-model-carousel-row .model-subtitle'), 800);
                const list = menu.querySelector('.model-options-container');
                if (list) list.scrollTop = 0;
                for (let batch = 0; batch < 24; batch++) {
                    const options = choices(menu);
                    for (const id of options.keys()) found.add(id);
                    button = options.get(target);
                    if (button || !list || !list.clientHeight || list.scrollTop + list.clientHeight >= list.scrollHeight - 1) break;
                    list.scrollTop += list.clientHeight;
                    await sleep(70);
                }
                if (button) break;
            }
            if (!found.size) throw new Error('模型菜单未列出可选的文字模型');
            if (!target) catalogue = [...found].slice(0, 256);
            if (target) {
                if (!button || !active || !temporary() || location.pathname !== pairing.path
                    || editor()?.value || isStop(runButton())) throw new Error('目标模型不可选或页面已被占用');
                button.click();
                if (!await waitFor(() => !carousel() && model() === target)) {
                    throw new Error('网页未切到所选模型，请检查账号权限和页面提示');
                }
            }
        } finally {
            if (menu.isConnected) {
                menu.closest('mat-dialog-container')?.querySelector('button[data-test-close-button]')?.click();
                await waitFor(() => !carousel());
            }
        }
    }

    function status() {
        if (!temporary() || location.pathname !== pairing.path) return 'occupied';
        if (document.querySelector('input[type=password]') || one('a[href*="accounts.google.com/ServiceLogin"]')) return 'login';
        const field = editor();
        if (field?.value || isStop(runButton())) return 'occupied';
        if (used) return 'recover';
        if (document.querySelector('ms-chat-turn')) return 'occupied';
        if (field && !field.disabled && !field.readOnly && canRun(runButton()) && model()) return 'ready';
        return Date.now() - born < 15000 ? 'loading' : 'recover';
    }

    function pulse(state, extra = {}) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST', url: endpoint, anonymous: true, timeout: 5000,
                headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + pairing.secret},
                data: JSON.stringify({tab: pairing.tab, page, state, model: model(), models: catalogue, ...extra}),
                onload: response => {
                    try {
                        if (response.status !== 200) throw new Error('本机连接失败 HTTP ' + response.status);
                        resolve(JSON.parse(response.responseText));
                    } catch (error) { reject(error); }
                },
                onerror: () => reject(new Error('本机服务离线')),
                ontimeout: () => reject(new Error('本机连接超时')),
            });
        });
    }

    function write(field, value) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, value);
        field.dispatchEvent(new Event('input', {bubbles: true}));
        field.dispatchEvent(new Event('change', {bubbles: true}));
    }

    function answer() {
        const turns = document.querySelectorAll('ms-chat-turn .chat-turn-container.model');
        if (turns.length !== 1) return '';
        const chunks = turns[0].querySelectorAll('.turn-content > ms-prompt-chunk.text-chunk > ms-text-chunk');
        return [...chunks].filter(visible).map(el => el.innerText).join('\n\n').trimEnd();
    }

    async function execute(task) {
        const job = task.job;
        let field;
        let submitted = false;
        let finished = false;
        let emitted = '';
        let sinceLastPulse = 0;
        const tick = async (event = '', text = '') => {
            const reply = await pulse('working', {job, event, text});
            if (reply.action === 'cancel') throw new Error('本机任务已结束');
            sinceLastPulse = Date.now();
        };
        try {
            if (status() !== 'ready') throw new Error('临时页状态已变化');
            if (model() !== task.model) {
                await tick();
                await inspectMenu(task.model);
            }
            field = editor();
            if (!field || status() !== 'ready' || model() !== task.model) {
                throw new Error('模型切换后输入框或页面状态已变化');
            }
            write(field, task.prompt);
            for (let i = 0; i < 25 && runButton()?.disabled; i++) await sleep(80);
            await tick();
            const button = runButton();
            if (!temporary() || location.pathname !== pairing.path || !button || !canRun(button)
                || button.disabled || editor() !== field || field.value !== task.prompt || model() !== task.model) {
                throw new Error('页面尚未就绪或模型已切换');
            }
            used = true;
            submitted = true;
            button.click();
            const started = Date.now();
            let sawStop = false;
            while (active && Date.now() - started < 890000) {
                await sleep(350);
                if (!temporary() || location.pathname !== pairing.path) throw new Error('执行页已切换');
                const control = runButton();
                if (one('ms-chat-turn [role="alert"], ms-chat-turn .error-message')) {
                    throw new Error('网页报告生成错误，请查看专用页');
                }
                sawStop ||= isStop(control);
                const text = answer();
                const done = canRun(control) && Boolean(text);
                // Hold back the current word or a short unbroken suffix during Markdown rendering.
                let boundary = Math.max(text.lastIndexOf('\n') + 1, text.lastIndexOf(' ') + 1, text.length - 32);
                if (boundary > 0 && /[\uD800-\uDBFF]/.test(text[boundary - 1])) boundary--;
                const stable = done ? text : text.slice(0, boundary);
                if (!stable.startsWith(emitted)) throw new Error('网页改写了已发送的文本，本次回复中断');
                const delta = stable.slice(emitted.length);
                for (let offset = 0; offset < delta.length;) {
                    let end = Math.min(offset + 65536, delta.length);
                    if (end < delta.length && /[\uD800-\uDBFF]/.test(delta[end - 1])) end--;
                    await tick('delta', delta.slice(offset, end));
                    offset = end;
                }
                emitted = stable;
                if (done) {
                    await tick('done');
                    finished = true;
                    return;
                }
                if (canRun(control) && (sawStop || Date.now() - started > 30000)) {
                    throw new Error('网页未返回可读取的文本，请查看临时页');
                }
                if (Date.now() - sinceLastPulse >= 1500) await tick();
            }
            throw new Error('浏览器执行已停止或超时');
        } catch (error) {
            // Never resend a submitted prompt, even if acknowledgement was lost.
            try { await tick('error', error.message); } catch { /* server disconnected */ }
        } finally {
            if (!submitted && field?.isConnected && field.value === task.prompt) write(field, '');
            if (submitted && !finished && temporary() && location.pathname === pairing.path && isStop(runButton())) {
                runButton().click();
            }
        }
    }

    async function listen() {
        if (active) return;
        active = true;
        renderStatus();
        let failures = 0;
        while (active) {
            try {
                if (status() === 'ready' && !one('mat-dialog-container') && Date.now() >= scanAfter) {
                    scanAfter = Date.now() + 60000;
                    try {
                        await inspectMenu();
                        scanAfter = Date.now() + 600000;
                    } catch { /* keep the current model available if the picker changes */ }
                }
                const reply = await pulse(status());
                failures = 0;
                connection = '已连接';
                renderStatus();
                if (!active) break;
                if (reply.action === 'refresh' && status() === 'recover') {
                    location.reload();
                    return;
                }
                if (reply.action === 'run') await execute(reply);
            } catch (error) {
                connection = error.message;
                renderStatus();
                failures++;
            }
            await sleep(Math.min(1000 * 2 ** Math.min(failures, 4), 15000));
        }
    }

    GM_getTab(tab => {
        pairing = tab[key];
        function description() {
            if (!pairing || !active) return paused ? '已暂停' : '未配对';
            const states = {ready: '就绪', loading: '加载中', recover: '下次接单前将重开临时页',
                occupied: '页面被占用或已离开临时页', login: '等待登录'};
            return [connection, states[status()], model()].filter(Boolean).join(' · ');
        }
        function pair() {
            if (active || paused) return alert('请先暂停本页接单并刷新页面，再重新配对。');
            if (!temporary() || editor()?.value || document.querySelector('ms-chat-turn') || isStop(runButton())) {
                return alert('请打开当前账号的空白专用临时页（new_chat?temporary=true）后配对。');
            }
            const secret = prompt('输入本机 browser-server 终端显示的标签页配对码');
            if (!secret?.trim()) return;
            pairing = {secret: secret.trim(), tab: pairing?.tab || crypto.randomUUID(), path: location.pathname};
            tab[key] = pairing;
            GM_saveTab(tab);
            void listen();
        }
        function pause() {
            active = false;
            paused = true;
            delete tab[key];
            GM_saveTab(tab);
            renderStatus();
            // A fresh document also terminates any outstanding polling loop.
            alert('本页接单已暂停。再次配对前请刷新此专用页。');
        }
        GM_registerMenuCommand('查看本页接单状态', () => alert(description()));
        GM_registerMenuCommand('重新读取网页模型列表', () => { scanAfter = 0; });
        GM_registerMenuCommand('配对此临时页 / 更新配对码', pair);
        GM_registerMenuCommand('暂停本页接单', pause);
        if (temporary()) {
            const panel = document.createElement('aside');
            panel.setAttribute('aria-label', '酒馆本机接单');
            panel.style.cssText = 'position:fixed;width:44px;height:44px;z-index:2147483646';
            const root = panel.attachShadow({mode: 'open'});
            const style = document.createElement('style');
            style.textContent = `
                :host{font:13px/1.4 system-ui,sans-serif;color:#eef3fc}
                button{border:0;border-radius:6px;padding:5px 9px;background:#d1e3ff;color:#17263c;font:inherit;cursor:pointer}
                button:focus-visible{outline:3px solid #75adff;outline-offset:2px}
                .orb{position:relative;width:44px;height:44px;border-radius:50%;padding:0;border:1px solid #647792;
                    background:#202734;color:#eef3fc;box-shadow:0 2px 7px #0004;touch-action:none;user-select:none;cursor:grab}
                .orb:active{cursor:grabbing}
                section{position:absolute;box-sizing:border-box;width:min(240px,calc(100vw - 16px));padding:12px;
                    border:1px solid #526176;border-radius:10px;background:#202734;box-shadow:0 3px 12px #0004;
                    display:grid;gap:8px;justify-items:start;overflow-wrap:anywhere;overflow:auto}
                section[hidden]{display:none}
            `;
            const orb = document.createElement('button');
            orb.type = 'button';
            orb.className = 'orb';
            orb.textContent = '接单';
            orb.title = '点击展开或收起，拖动调整位置';
            orb.setAttribute('aria-label', '酒馆接单控制');
            orb.setAttribute('aria-expanded', 'false');
            orb.setAttribute('aria-controls', 'relay-controls');
            const section = document.createElement('section');
            section.id = 'relay-controls';
            section.hidden = true;
            const name = document.createElement('strong');
            name.textContent = '酒馆接单';
            const state = document.createElement('span');
            const action = document.createElement('button');
            action.type = 'button';
            action.onclick = event => {
                if (!event.isTrusted) return;
                if (active) pause();
                else if (paused) location.reload();
                else pair();
            };
            renderStatus = () => {
                state.textContent = description();
                action.textContent = active ? '暂停接单' : paused ? '刷新此页' : '配对此页';
            };
            renderStatus();
            section.append(name, state, action);
            root.append(style, orb, section);
            document.body.append(panel);

            // Store relative coordinates in the tab, so a smaller window can still reach the control.
            const clamp = (n, max) => Math.min(Math.max(0, n), max);
            let position = tab.relayOrbPosition || {x: 1, y: 0.52};
            function bounds() {
                return {x: Math.max(0, innerWidth - orb.offsetWidth - 16),
                    y: Math.max(0, innerHeight - orb.offsetHeight - 16)};
            }
            function layout() {
                const limit = bounds();
                const left = 8 + clamp(position.x * limit.x, limit.x);
                const top = 8 + clamp(position.y * limit.y, limit.y);
                panel.style.left = left + 'px';
                panel.style.top = top + 'px';
                if (section.hidden) return;
                const roomBelow = innerHeight - top - orb.offsetHeight - 16;
                const below = roomBelow >= top - 16;
                section.style.top = below ? 'calc(100% + 8px)' : 'auto';
                section.style.bottom = below ? 'auto' : 'calc(100% + 8px)';
                section.style.maxHeight = Math.max(0, below ? roomBelow : top - 16) + 'px';
                section.style.left = (8 + clamp(left - 8, Math.max(0, innerWidth - section.offsetWidth - 16)) - left) + 'px';
            }
            function expand(open) {
                section.hidden = !open;
                orb.setAttribute('aria-expanded', String(open));
                layout();
            }
            let drag;
            let moved = false;
            orb.addEventListener('pointerdown', event => {
                if (event.button !== 0 || !event.isPrimary) return;
                const rect = panel.getBoundingClientRect();
                drag = {id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top};
                moved = false;
                orb.setPointerCapture(event.pointerId);
            });
            orb.addEventListener('pointermove', event => {
                if (drag?.id !== event.pointerId) return;
                const dx = event.clientX - drag.x;
                const dy = event.clientY - drag.y;
                if (!moved && Math.hypot(dx, dy) < 5) return;
                moved = true;
                const limit = bounds();
                position = {x: clamp(drag.left + dx - 8, limit.x) / (limit.x || 1),
                    y: clamp(drag.top + dy - 8, limit.y) / (limit.y || 1)};
                layout();
            });
            orb.addEventListener('lostpointercapture', event => {
                if (drag?.id !== event.pointerId) return;
                drag = null;
                if (moved) {
                    tab.relayOrbPosition = position;
                    GM_saveTab(tab);
                }
            });
            orb.onclick = event => {
                if (!moved || event.detail === 0) expand(section.hidden);
            };
            root.addEventListener('keydown', event => {
                if (event.key === 'Escape' && !section.hidden) {
                    expand(false);
                    orb.focus();
                    event.stopPropagation();
                }
            });
            window.addEventListener('resize', layout);
            layout();
        }
        if (pairing && temporary() && location.pathname === pairing.path) void listen();
    });
})();
