// lib/drift.mjs — 方向偏离信号判定（零依赖，纯函数）
// 口径：只报可从 Machine Summary 直接算出的结构化信号，不读报告正文、不做语义猜测。
// 纪律：只读运行时事实；信号只用于决定是否提问，不进评分、不冒充客观事实来源（反幻觉纪律）。
// 主诉求有效性复用 intent-routing.mjs 的规则表键，不另立第二份枚举。
// ADR-0002：provenance 过滤下沉在共享数据层，消费端不重复实现、不 opt-in。

import { INTENT_ROUTES } from './intent-routing.mjs';

export const DRIFT_THRESHOLDS = {
  min_streak: 3,           // 连续 N 套才成信号
  budget_near_ratio: 0.95, // 无绝对上限时，总价 ≥ 预算上沿 × 该比例视为贴近上限
};

// 主诉求 → 该诉求在 Machine Summary 里应被覆盖的必核实字段（缺失/未评分 = 未覆盖）
export const GOAL_EVIDENCE_FIELDS = {
  education: ['policy_lock_risk'],
  investment: ['rent_status'],
  owner_occupy: ['score_location', 'score_property'],
};

const CAVEAT = '信号只用于决定是否提问，不进评分、不冒充客观事实来源；含数据完备性提示，需人工确认，不等于用户意图变更（反幻觉纪律）';

function hasValue(v) {
  if (v == null || v === '' || v === 'not_evaluated' || v === '未核实') return false;
  return typeof v === 'number' ? Number.isFinite(v) : true;
}

// 单套报告是否覆盖了某主诉求的必核实字段；主诉求未定义时返回 null。
export function goalEvidenceMet(goal, report) {
  const fields = GOAL_EVIDENCE_FIELDS[goal];
  if (!fields) return null;
  return fields.every(f => hasValue(report?.[f]));
}

// 从已解析的报告行与关注清单行派生观察记录（纯函数；IO 由 CLI 承担，零写入）。
// void 过滤由 collectReports / parseWatchlist 在共享层完成，这里不做第二次过滤（ADR-0002）；
// 清单备注只读附带，作为依据的一部分，不参与判定。
export function buildObservations(reports = [], watchRows = []) {
  const watchByNo = new Map(watchRows.map(w => [String(w.no), w]));
  return reports
    .map(r => {
      const goal_evidence = {};
      for (const goal of Object.keys(GOAL_EVIDENCE_FIELDS)) goal_evidence[goal] = goalEvidenceMet(goal, r) === true;
      return {
        report_no: r.report_no,
        community: r.community ?? '',
        total_price_wan: r.total_price_wan ?? null,
        provenance: r.provenance ?? 'legacy',
        note: watchByNo.get(String(r.report_no))?.note ?? '',
        goal_evidence,
      };
    })
    .sort((a, b) => String(a.report_no ?? '').localeCompare(String(b.report_no ?? '')));
}

// 最近 N 套是否全部满足 predicate（全部命中才返回，否则空）
function allRecentHit(recent, minStreak, predicate) {
  const hit = recent.filter(predicate);
  return hit.length === minStreak ? hit : [];
}

function sanitizeThresholds(thresholds) {
  const rawStreak = Number(thresholds.min_streak);
  const rawRatio = Number(thresholds.budget_near_ratio);
  return {
    min_streak: Number.isInteger(rawStreak) && rawStreak > 0 ? rawStreak : DRIFT_THRESHOLDS.min_streak,
    budget_near_ratio: Number.isFinite(rawRatio) && rawRatio > 0 && rawRatio <= 1
      ? rawRatio : DRIFT_THRESHOLDS.budget_near_ratio,
  };
}

export function detectDrift({
  primary_goal, walk_away_wan = null, total_range_wan = null,
  observations = [], thresholds = {},
} = {}) {
  const t = sanitizeThresholds({ ...DRIFT_THRESHOLDS, ...thresholds });
  const goal = String(primary_goal ?? '').trim();
  const validGoal = Object.prototype.hasOwnProperty.call(INTENT_ROUTES, goal);
  const rows = (observations ?? []).slice()
    .sort((a, b) => String(a.report_no ?? '').localeCompare(String(b.report_no ?? '')));

  const undetermined = (reason) => ({
    status: 'undetermined', primary_goal: validGoal ? goal : null,
    sample_size: rows.length, min_streak: t.min_streak,
    signals: [], reason, caveat: CAVEAT,
  });

  if (!validGoal) return undetermined('主诉求未定义或不在规则表内 → 无法判定，先跑 /house-ops intake');
  if (rows.length < t.min_streak) return undetermined(`样本不足（${rows.length} < ${t.min_streak}）→ 无法判定，不勉强下结论`);

  const recent = rows.slice(-t.min_streak);
  const signals = [];

  // 信号 A：预算越线 / 贴近绝对上限
  const cap = Number(walk_away_wan);
  const upper = Array.isArray(total_range_wan) ? Number(total_range_wan[1]) : NaN;
  const budgetLimit = Number.isFinite(cap) && cap > 0
    ? cap
    : (Number.isFinite(upper) && upper > 0 ? Math.round(upper * t.budget_near_ratio) : null);
  if (budgetLimit != null) {
    const hit = allRecentHit(recent, t.min_streak,
      o => Number.isFinite(Number(o.total_price_wan)) && Number(o.total_price_wan) >= budgetLimit);
    if (hit.length) {
      signals.push({
        kind: 'budget_pressure',
        report_nos: hit.map(o => o.report_no),
        detail: `最近连续 ${hit.length} 套总价 ${hit.map(o => o.total_price_wan).join('/')} 万 ≥ 上限口径 ${budgetLimit} 万`,
      });
    }
  }

  // 信号 B：主诉求必核实字段的评估覆盖度缺口（数据完备性提示，不等于意图改变）
  const missing = allRecentHit(recent, t.min_streak, o => o.goal_evidence?.[goal] === false);
  if (missing.length) {
    signals.push({
      kind: 'goal_coverage_gap',
      report_nos: missing.map(o => o.report_no),
      detail: `最近连续 ${missing.length} 套的 ${GOAL_EVIDENCE_FIELDS[goal].join(', ')} 未填写/未核实；属评估覆盖度缺口，不表示用户意图改变`,
    });
  }

  return {
    status: signals.length ? 'drift' : 'aligned',
    primary_goal: goal,
    sample_size: rows.length,
    min_streak: t.min_streak,
    signals,
    reason: signals.length
      ? `最近 ${t.min_streak} 套出现 ${signals.length} 类可复核信号（需人工确认）`
      : `最近 ${t.min_streak} 套未发现可复核的偏离信号`,
    caveat: CAVEAT,
  };
}
