/**
 * Monaco Editor Workers 本地化配置。
 *
 * @monaco-editor/react 默认从 jsDelivr CDN 加载 Monaco 本体和 Workers。
 * 在 Electron 桌面端这会导致：
 * - 离线时编辑器完全不可用
 * - 在线时每次打开都要等网络请求
 * - Workers 加载延迟导致语法高亮/自动补全卡顿
 *
 * 本文件配置 Vite worker import + loader.config，让一切从本地 bundle 加载。
 * 在 main.tsx 最顶部 import 此文件。
 */

import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';

self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    if (label === 'json') return new jsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    return new editorWorker();
  },
};

// 告诉 @monaco-editor/react 使用本地 Monaco，不从 CDN 加载
loader.config({ monaco });
