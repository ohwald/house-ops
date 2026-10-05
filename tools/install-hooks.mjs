#!/usr/bin/env node
// install-hooks.mjs — 装一个本地 pre-push 钩子，挡住「直接 push 到受保护分支」。
//
// 为什么还需要它：GitHub 的分支保护是第二道防线，但它只在推送到远端后才生效，
// 手滑的 `git push origin main` 得先出门才被拦。本地钩子在你按回车那一刻就拦住。
//
// 用法: node tools/install-hooks.mjs [--uninstall]
// 紧急绕过（罕见，且仅限仓库所有者）: HOUSE_OPS_ALLOW_MAIN_PUSH=1 git push ...
//
// 为什么放在 tools/：这是仓库维护者的本地工具，不属于分发给用户的技能包。

import { writeFile, readFile, unlink, chmod, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOOK_PATH = join(ROOT, '.git', 'hooks', 'pre-push');
const MARKER = 'house-ops pre-push guard';
const PROTECTED = ['main', 'master'];

const SCRIPT = `#!/bin/sh
# ${MARKER} — installed by \`node tools/install-hooks.mjs\`
# Blocks direct pushes to ${PROTECTED.join(' / ')}; open a PR and let ci-gate pass instead.
# Emergency override: HOUSE_OPS_ALLOW_MAIN_PUSH=1 git push ...

if [ "$HOUSE_OPS_ALLOW_MAIN_PUSH" = "1" ]; then
  exit 0
fi

while read -r _local_ref _local_sha remote_ref _remote_sha; do
  case "$remote_ref" in
    ${PROTECTED.map((b) => `refs/heads/${b}`).join('|')})
      echo "⛔ 不允许直接推送到 $remote_ref —— 请开 PR，等 ci-gate 全绿后再 squash 合并。" >&2
      echo "   git push -u origin \\$(git branch --show-current) 然后 gh pr create" >&2
      echo "   （紧急绕过：HOUSE_OPS_ALLOW_MAIN_PUSH=1 git push ...）" >&2
      exit 1
      ;;
  esac
done

exit 0
`;

async function main() {
  const isRepo = await stat(join(ROOT, '.git')).then(() => true).catch(() => false);
  if (!isRepo) throw new Error('没找到 .git —— 请在仓库根目录运行');

  if (process.argv.includes('--uninstall')) {
    const cur = await readFile(HOOK_PATH, 'utf8').catch(() => null);
    if (cur && !cur.includes(MARKER)) throw new Error(`${HOOK_PATH} 不是本工具装的，拒绝删除`);
    await unlink(HOOK_PATH).catch(() => {});
    console.log('已卸载 pre-push 钩子');
    return;
  }

  const existing = await readFile(HOOK_PATH, 'utf8').catch(() => null);
  if (existing && !existing.includes(MARKER)) {
    throw new Error(`${HOOK_PATH} 已存在且不是本工具装的 —— 不覆盖，先备份后再手动处理`);
  }

  await writeFile(HOOK_PATH, SCRIPT);
  await chmod(HOOK_PATH, 0o755);
  console.log(`已安装 ${HOOK_PATH}`);
  console.log('现在 `git push origin main` 会被本地拦下；紧急时加 HOUSE_OPS_ALLOW_MAIN_PUSH=1。');
}

main().catch((e) => { console.error('⛔', e.message); process.exitCode = 1; });
