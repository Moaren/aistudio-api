// ==UserScript==
// @name         AI Studio 标签页保活
// @namespace    https://aistudio.google.com/
// @version      1.0.0
// @description  手动开启本机画中画或低音量音频，减少 AI Studio 标签页被浏览器挂起的机会。
// @match        https://aistudio.google.com/*
// @run-at       document-idle
// @noframes
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    const panelId = 'aistudio-tab-keepalive';
    if (document.getElementById(panelId)) return;

    const pipApi = window.documentPictureInPicture;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    let pipWindow = null;
    let audio = null;
    let pageActive = true;

    const panel = document.createElement('div');
    panel.id = panelId;
    const shadow = panel.attachShadow({ mode: 'open' });
    const panelStyles = new CSSStyleSheet();
    panelStyles.replaceSync(`
        :host {
            all: initial;
            position: fixed;
            right: 16px;
            bottom: 16px;
            z-index: 2147483647;
            max-width: calc(100vw - 32px);
            font: 13px system-ui, sans-serif;
            color: #ecf0f6;
        }
        .panel {
            padding: 7px;
            border: 1px solid #343c48;
            border-radius: 12px;
            background: #1a1f27;
            box-shadow: 0 4px 16px #0004;
        }
        .controls { display: flex; gap: 6px; }
        button {
            padding: 6px 10px;
            border: 1px solid #566272;
            border-radius: 7px;
            background: #262e3a;
            color: inherit;
            font: inherit;
            cursor: pointer;
        }
        button[aria-pressed="true"] {
            border-color: #8bdab5;
            background: #204a3a;
        }
        button:focus-visible { outline: 2px solid #b9e2ff; outline-offset: 2px; }
        button:disabled { opacity: .55; cursor: default; }
        #message { margin: 6px 2px 0; max-width: 250px; color: #dae2ed; }
        #message:empty { display: none; }
    `);
    shadow.adoptedStyleSheets = [panelStyles];
    const content = document.createElement('section');
    content.className = 'panel';
    content.setAttribute('aria-label', 'AI Studio 标签页保活');
    const controls = document.createElement('div');
    controls.className = 'controls';
    const message = document.createElement('div');
    message.id = 'message';
    message.setAttribute('role', 'status');

    const pipButton = document.createElement('button');
    pipButton.type = 'button';
    pipButton.textContent = '画中画';
    const audioButton = document.createElement('button');
    audioButton.type = 'button';
    audioButton.textContent = '低音量音频';

    const supportsPip = typeof pipApi?.requestWindow === 'function';
    const supportsAudio = typeof AudioContext === 'function';
    pipButton.disabled = !supportsPip;
    pipButton.title = supportsPip ? '开启或关闭画中画' : '此浏览器不支持文档画中画';
    audioButton.disabled = !supportsAudio;
    audioButton.title = supportsAudio ? '开启或关闭低音量播放' : '此浏览器不支持 Web Audio';

    controls.append(pipButton, audioButton);
    content.append(controls, message);
    shadow.append(content);
    document.body.append(panel);

    function updateButtons() {
        pipButton.setAttribute('aria-pressed', String(Boolean(pipWindow && !pipWindow.closed)));
        audioButton.setAttribute('aria-pressed', String(audio?.context.state === 'running'));
    }

    function stopPip() {
        const opened = pipWindow;
        pipWindow = null;
        if (opened && !opened.closed) opened.close();
        updateButtons();
    }

    pipButton.addEventListener('click', async () => {
        message.textContent = '';
        if (pipWindow && !pipWindow.closed) {
            stopPip();
            return;
        }
        if (pipApi.window) {
            message.textContent = '请先关闭本页已有的画中画。';
            return;
        }

        pipButton.disabled = true;
        try {
            const opened = await pipApi.requestWindow({ width: 250, height: 120 });
            if (!pageActive) {
                opened.close();
                return;
            }
            pipWindow = opened;
            opened.addEventListener('pagehide', () => {
                if (pipWindow === opened) {
                    pipWindow = null;
                    updateButtons();
                }
            }, { once: true });

            const pipDocument = opened.document;
            pipDocument.title = 'AI Studio 保活';
            pipDocument.documentElement.lang = 'zh-CN';
            pipDocument.body.style.cssText = [
                'margin: 0', 'min-height: 100vh', 'display: grid', 'place-items: center',
                'background: #1a1f27', 'color: #ecf0f6', 'font: 15px system-ui, sans-serif',
            ].join(';');
            pipDocument.body.textContent = 'AI Studio 画中画已开启';
        } catch (error) {
            stopPip();
            message.textContent = `画中画开启失败（${error.name || '浏览器限制'}）。`;
        } finally {
            pipButton.disabled = false;
            updateButtons();
        }
    });

    function stopAudio() {
        const session = audio;
        audio = null;
        if (session && session.context.state !== 'closed') {
            if (session.oscillator) session.oscillator.stop();
            void session.context.close().catch(() => {});
        }
        updateButtons();
    }

    audioButton.addEventListener('click', async () => {
        message.textContent = '';
        if (audio?.context.state === 'running') {
            stopAudio();
            return;
        }

        stopAudio();
        audioButton.disabled = true;
        try {
            const context = new AudioContext();
            const session = { context, oscillator: null };
            audio = session;
            const oscillator = context.createOscillator();
            const volume = context.createGain();
            oscillator.frequency.value = 32;
            volume.gain.value = 0.002;
            oscillator.connect(volume).connect(context.destination);
            oscillator.start();
            session.oscillator = oscillator;

            context.addEventListener('statechange', () => {
                if (audio !== session) return;
                if (context.state === 'running') {
                    message.textContent = '';
                } else if (!audioButton.disabled) {
                    message.textContent = '音频已暂停，点击按钮可重新开启。';
                }
                updateButtons();
            });

            await context.resume();
            if (audio !== session) return;
            if (context.state !== 'running') throw new Error('AudioContext is not running');
        } catch (error) {
            stopAudio();
            if (pageActive) {
                message.textContent = `音频开启失败（${error.name || '浏览器限制'}）。`;
            }
        } finally {
            audioButton.disabled = false;
            updateButtons();
        }
    });

    window.addEventListener('pagehide', () => {
        pageActive = false;
        stopPip();
        stopAudio();
    });
    window.addEventListener('pageshow', () => {
        pageActive = true;
        message.textContent = '';
    });
    updateButtons();
})();
