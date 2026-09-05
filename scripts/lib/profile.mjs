// lib/profile.mjs — config/profile.yml 的保真解析与安全更新
// 规范：零依赖。严格保护用户的注释、缩进与未修改字段。

import { readFile, writeFile } from 'node:fs/promises';

/**
 * 提取 profile 中的核心标量与常用区间配置
 */
export function parseProfile(yamlText) {
  if (!yamlText) return null;

  const getMatch = (re, transform = x => x) => {
    const m = re.exec(yamlText);
    if (!m) return null;
    const clean = m[1].replace(/\s+#.*$/, '').trim();
    return clean ? transform(clean) : null;
  };

  const getArray2 = re => {
    const m = re.exec(yamlText);
    if (!m) return null;
    const clean = m[1].replace(/\s+#.*$/, '').trim();
    const items = clean.split(',').map(s => Number(s.trim())).filter(n => !Number.isNaN(n));
    return items.length >= 2 ? [items[0], items[1]] : null;
  };

  return {
    buyer: {
      city: getMatch(/^ {2}city:\s*([^\n]+)/m),
      work_location: getMatch(/^ {2}work_location:\s*([^\n]+)/m),
      commute_max_minutes: getMatch(/^ {2}commute_max_minutes:\s*([^\n]+)/m, v => (v === 'null' || v === '' ? null : Number(v))),
    },
    budget: {
      total_range_wan: getArray2(/^ {2}total_range_wan:\s*\[(.*?)\]/m),
      walk_away_wan: getMatch(/^ {2}walk_away_wan:\s*(\d+(?:\.\d+)?)/m, Number),
      payment: getMatch(/^ {2}payment:\s*([^\n]+)/m),
      loan_type: getMatch(/^ {2}loan_type:\s*([^\n]+)/m),
    },
    preferences: {
      layout: getMatch(/^ {2}layout:\s*([^\n]+)/m),
      size_range_sqm: getArray2(/^ {2}size_range_sqm:\s*\[(.*?)\]/m),
      building_age_max: getMatch(/^ {2}building_age_max:\s*(\d+)/m, Number),
      elevator_required: getMatch(/^ {2}elevator_required:\s*(true|false)/m, v => v === 'true'),
    },
    thresholds: {
      deep_dive_min: getMatch(/^ {2}deep_dive_min:\s*(\d+(?:\.\d+)?)/m, Number) ?? 4.0,
      give_up_below: getMatch(/^ {2}give_up_below:\s*(\d+(?:\.\d+)?)/m, Number) ?? 3.5,
    },
  };
}

/**
 * 安全且保留注释更新核心字段
 * @param {string} originalYaml 原始 YAML 内容
 * @param {object} patch 需要更新的字段
 * @returns {string} 更新后的 YAML
 */
export function updateProfileFields(originalYaml, patch) {
  let text = originalYaml;

  const replaceField = (regex, newLineGen) => {
    text = text.replace(regex, newLineGen);
  };

  if (patch.buyer) {
    if (patch.buyer.city !== undefined) {
      replaceField(/(^ {2}city:\s*)([^#\n]*?)(\s*(?:#.*)?)$/m, `$1${patch.buyer.city}$3`);
    }
    if (patch.buyer.work_location !== undefined) {
      replaceField(/(^ {2}work_location:\s*)([^#\n]*?)(\s*(?:#.*)?)$/m, `$1${patch.buyer.work_location}$3`);
    }
    if (patch.buyer.commute_max_minutes !== undefined) {
      const val = patch.buyer.commute_max_minutes === null ? 'null' : patch.buyer.commute_max_minutes;
      replaceField(/(^ {2}commute_max_minutes:\s*)([^#\n]*?)(\s*(?:#.*)?)$/m, `$1${val}$3`);
    }
  }

  if (patch.budget) {
    if (Array.isArray(patch.budget.total_range_wan)) {
      const [min, max] = patch.budget.total_range_wan;
      replaceField(/(^ {2}total_range_wan:\s*\[)(.*?)(\])([^#\n]*?)(\s*(?:#.*)?)$/m, `$1${min}, ${max}$3$5`);
    }
    if (patch.budget.walk_away_wan !== undefined) {
      replaceField(/(^ {2}walk_away_wan:\s*)([^#\n]*?)(\s*(?:#.*)?)$/m, `$1${patch.budget.walk_away_wan}$3`);
    }
  }

  if (patch.preferences) {
    if (patch.preferences.layout !== undefined) {
      replaceField(/(^ {2}layout:\s*)([^#\n]*?)(\s*(?:#.*)?)$/m, `$1${patch.preferences.layout}$3`);
    }
    if (Array.isArray(patch.preferences.size_range_sqm)) {
      const [min, max] = patch.preferences.size_range_sqm;
      replaceField(/(^ {2}size_range_sqm:\s*\[)(.*?)(\])([^#\n]*?)(\s*(?:#.*)?)$/m, `$1${min}, ${max}$3$5`);
    }
    if (patch.preferences.building_age_max !== undefined) {
      replaceField(/(^ {2}building_age_max:\s*)([^#\n]*?)(\s*(?:#.*)?)$/m, `$1${patch.preferences.building_age_max}$3`);
    }
    if (patch.preferences.elevator_required !== undefined) {
      replaceField(/(^ {2}elevator_required:\s*)([^#\n]*?)(\s*(?:#.*)?)$/m, `$1${patch.preferences.elevator_required}$3`);
    }
  }

  if (patch.thresholds) {
    if (patch.thresholds.deep_dive_min !== undefined) {
      replaceField(/(^ {2}deep_dive_min:\s*)([^#\n]*?)(\s*(?:#.*)?)$/m, `$1${patch.thresholds.deep_dive_min}$3`);
    }
    if (patch.thresholds.give_up_below !== undefined) {
      replaceField(/(^ {2}give_up_below:\s*)([^#\n]*?)(\s*(?:#.*)?)$/m, `$1${patch.thresholds.give_up_below}$3`);
    }
  }

  return text;
}
