/**
 * TextMate Grammar 初始化
 *
 * Monaco standalone 默认用 Monarch tokenizer（粗粒度正则），
 * 语法高亮只有 keyword/string/number 等十几种 token 类型。
 * 本模块注册 VS Code 级别的 TextMate Grammar，实现精确高亮。
 *
 * 依赖：
 *   vscode-textmate    — TextMate 语法解析引擎
 *   vscode-oniguruma   — oniguruma 正则的 WASM 运行时
 *
 * 原理：
 *   1. 加载 oniguruma WASM（全局一次）
 *   2. 创建 Registry（持有 grammar 文件加载器）
 *   3. 为每种语言注册 monaco.languages.TokensProvider
 *      - getInitialState() 返回 TextMate INITIAL 状态
 *      - tokenize(line, state) 调用 grammar.tokenizeLine() 得到 token 列表
 *   4. Monaco 在创建 model 时自动调用 tokens provider 做 tokenization
 *
 * 调用时机：在 beforeMount 或 onMount 中调用（Monaco 实例已加载），
 *           幂等，重复调用不会重复注册。
 */

import type * as Monaco from "monaco-editor";
import * as oniguruma from "vscode-oniguruma";
import * as vsctm from "vscode-textmate";
import type { IGrammar, StateStack } from "vscode-textmate";

// ─── WASM 初始化 ──────────────────────────────────────────────────

let wasmInitialized = false;

/**
 * 加载 oniguruma WASM。
 * 用 Vite 的 ?url import 确保在 Electron + Vite 下路径正确解析。
 */
async function initOniguruma(): Promise<void> {
  if (wasmInitialized) return;

  // Vite ?url import 返回打包后的 wasm 文件 URL
  const wasmUrl = (await import("vscode-oniguruma/release/onig.wasm?url")).default;

  const response = await fetch(wasmUrl);
  const wasmBuffer = await response.arrayBuffer();

  await oniguruma.loadWASM({
    data: wasmBuffer,
  });

  wasmInitialized = true;
}

// ─── Registry ─────────────────────────────────────────────────────

let registry: vsctm.Registry | null = null;

/**
 * scopeName → grammar 加载函数
 * 返回 vsctm.IRawGrammar 对象（从 .tmLanguage.json 解析得到）
 */
type GrammarLoader = (scopeName: string) => Promise<vsctm.IRawGrammar | null>;

const GRAMMAR_LOADERS: Record<string, GrammarLoader> = {};

function getRegistry(): vsctm.Registry {
  if (registry) return registry;

  registry = new vsctm.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (sources: string[]) =>
        new oniguruma.OnigScanner(sources),
      createOnigString: (str: string) => new oniguruma.OnigString(str),
    } as vsctm.IOnigLib),
    loadGrammar: async (scopeName: string) => {
      const loader = GRAMMAR_LOADERS[scopeName];
      if (!loader) return null;
      return loader(scopeName);
    },
  });

  return registry;
}

// ─── 语言注册表 ────────────────────────────────────────────────────

interface LanguageGrammarConfig {
  /** Monaco language id */
  languageId: string;
  /** TextMate scope name */
  scopeName: string;
  /** grammar 加载函数 */
  loadGrammar: GrammarLoader;
}

const LANGUAGE_GRAMMARS: LanguageGrammarConfig[] = [];

/**
 * 注册一种语言的 TextMate grammar。
 * 在模块加载时同步调用，确保 Monaco 实例创建前就绪。
 */
export function registerGrammar(
  languageId: string,
  scopeName: string,
  loadGrammar: GrammarLoader,
): void {
  LANGUAGE_GRAMMARS.push({ languageId, scopeName, loadGrammar });
  GRAMMAR_LOADERS[scopeName] = loadGrammar;
}

// ─── Monaco TokensProvider 适配器 ──────────────────────────────────

/**
 * 把 TextMate grammar 适配成 Monaco 的 TokensProvider 接口。
 *
 * Monaco 的 TokensProvider 是同步的（tokenize 返回 IToken[]），
 * 但 TextMate grammar 加载是异步的。
 * 解决：在 init 时预加载所有 grammar，加载完成后 grammarRef 有值，
 * tokenize 时同步调用 grammarRef.tokenizeLine()。
 */
class TextMateTokensProvider implements Monaco.languages.TokensProvider {
  private grammar: IGrammar | null = null;
  private readonly scopeName: string;
  private readonly reg: vsctm.Registry;

  constructor(reg: vsctm.Registry, scopeName: string) {
    this.reg = reg;
    this.scopeName = scopeName;
  }

  async load(): Promise<void> {
    this.grammar = await this.reg.loadGrammar(this.scopeName);
  }

  getInitialState(): Monaco.languages.IState {
    return new TextMateState(vsctm.INITIAL);
  }

  tokenize(
    line: string,
    state: Monaco.languages.IState,
  ): Monaco.languages.ILineTokens {
    if (!this.grammar) {
      return { tokens: [], endState: state };
    }

    const tmState = (state as TextMateState).stack;
    const result = this.grammar.tokenizeLine(line, tmState);

    const tokens: Monaco.languages.IToken[] = result.tokens.map((t) => ({
      startIndex: t.startIndex,
      scopes: scopeToMonacoToken(t.scopes),
    }));

    return {
      tokens,
      endState: new TextMateState(result.ruleStack),
    };
  }
}

/**
 * TextMate scope 数组 → Monaco 主题兼容的短 token 名
 *
 * TextMate scope 是层级的：["source.ts", "keyword.control.ts"]
 * Monaco defineTheme 的 rules 用短名匹配："keyword", "string", etc.
 * 取最具体 scope 的第一段作为 token 名，让主题能正确染色。
 *
 * 映射规则参考 VS Code 的 scope → token 对应关系。
 */
function scopeToMonacoToken(scopes: string[]): string {
  // 取最具体的 scope（最后一个）
  const scope = scopes[scopes.length - 1] ?? "";

  // 提取第一段
  const parts = scope.split(".");
  const head = parts[0] ?? "";

  // 常见映射
  switch (head) {
    case "keyword":
    case "storage":
      // 区分 control flow
      if (parts.includes("control")) return "keyword.control";
      if (parts.includes("type")) return "storage.type";
      return "keyword";
    case "string":
      return "string";
    case "constant":
      if (parts.includes("numeric")) return "number";
      if (parts.includes("language")) return "constant.language";
      return "constant";
    case "comment":
      return "comment";
    case "entity": {
      if (parts.includes("name") && parts.includes("function")) return "entity.name.function";
      if (parts.includes("name") && parts.includes("type")) return "entity.name.type";
      if (parts.includes("name") && parts.includes("class")) return "entity.name.class";
      if (parts.includes("name") && parts.includes("tag")) return "entity.name.tag";
      if (parts.includes("other") && parts.includes("attribute-name")) return "entity.other.attribute-name";
      return "identifier";
    }
    case "variable":
      if (parts.includes("parameter")) return "variable.parameter";
      if (parts.includes("property")) return "variable.property";
      if (parts.includes("language")) return "variable.language";
      return "variable";
    case "support":
      if (parts.includes("function")) return "support.function";
      if (parts.includes("type")) return "support.type";
      if (parts.includes("class")) return "support.class";
      if (parts.includes("constant")) return "support.constant";
      if (parts.includes("variable")) return "support.variable";
      return "identifier";
    case "meta":
      if (parts.includes("decorator")) return "decorator";
      return "identifier";
    case "punctuation":
      return "delimiter";
    default:
      return "identifier";
  }
}

/** 包装 TextMate StateStack 为 Monaco IState */
class TextMateState implements Monaco.languages.IState {
  constructor(public readonly stack: StateStack) {}

  clone(): Monaco.languages.IState {
    return new TextMateState(this.stack.clone());
  }

  equals(other: Monaco.languages.IState): boolean {
    if (!(other instanceof TextMateState)) return false;
    return this.stack.equals(other.stack);
  }
}

// ─── Monaco 集成 ──────────────────────────────────────────────────

let monacoInitialized = false;

/**
 * 初始化 TextMate grammar 到 Monaco 实例。
 * 幂等，重复调用安全。
 *
 * 在 beforeMount 或 onMount 中调用。
 */
export async function initTextMateGrammars(monaco: typeof Monaco): Promise<void> {
  if (monacoInitialized) return;
  monacoInitialized = true;

  await initOniguruma();
  const reg = getRegistry();

  // 为每种语言创建 tokens provider 并预加载 grammar
  await Promise.all(
    LANGUAGE_GRAMMARS.map(async (config) => {
      const provider = new TextMateTokensProvider(reg, config.scopeName);
      await provider.load();
      monaco.languages.setTokensProvider(config.languageId, provider);
    }),
  );
}

// ─── 重置（HMR 用） ───────────────────────────────────────────────

export function resetTextMateGrammars(): void {
  monacoInitialized = false;
  wasmInitialized = false;
  registry = null;
}
