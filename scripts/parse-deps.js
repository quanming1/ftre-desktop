/**
 * parse-deps.js — 从 pyproject.toml 解析 [project.dependencies] 列表
 * 返回依赖字符串数组（如 ["litellm>=1.0.0", "fastapi>=0.100.0"]）
 */
const fs = require("fs");

function parseTomlDeps(tomlPath) {
  const t = fs.readFileSync(tomlPath, "utf-8");

  // 找到 dependencies = [ ... ] 块（从 "dependencies = [" 到独占一行的 "]")
  const startIdx = t.indexOf("dependencies = [");
  if (startIdx === -1) return [];

  // 从 startIdx 开始找独占一行的 ]
  const afterBracket = t.indexOf("[", startIdx) + 1;
  const endIdx = t.indexOf("\n]", afterBracket);
  if (endIdx === -1) return [];

  const raw = t.slice(afterBracket, endIdx);

  // 提取每个引号包裹的依赖字符串
  const deps = [];
  const re = /"([^"]+)"/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    deps.push(m[1]);
  }
  return deps;
}

module.exports = { parseTomlDeps };
