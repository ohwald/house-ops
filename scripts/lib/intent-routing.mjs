// lib/intent-routing.mjs — 主诉求 → 评估重心路由（零依赖）
// 口径 SoT：modes/_shared.md「主诉求路由（评估重心）」节；报告呈现见 modes/evaluate.md Step 0.5。
// 纪律：路由只决定「深挖重心 / 必核实清单 / 方案倾向」，不产生算术权重、不新增评分维度，
//       不改综合评分「整体判断而非算术平均」的口径；按意图生效的一票否决并入既有结构性封顶规则，
//       不在本表另立枚举、状态或第二套判定逻辑。

export const INTENT_ROUTES = {
  education: {
    label: '教育',
    deep_dive: [
      'Location：学区配套与中考升学硬核核查（双学区对口、办学历史、推进率与中考出口数据）',
      'Risk：五年一户/六年一户学位锁定、提前落户年限、学位占用与释放状态',
    ],
    verify: [
      '教育局当年度施教区公示（法定划片）',
      '对口小学与初中全称、升学机制与近年中考出口数据',
      '不动产/户籍底册的学位占用与五年一户执行口径',
    ],
    scenario: '学区优先；必要时牺牲面积尺度、通勤时长或房龄次新',
  },
  investment: {
    label: '投资',
    deep_dive: [
      'Price：历史成交与抗跌性走势（周期回调、挂牌-成交折价弹性、去化周期与流动性陷阱）',
      'Price：租售比与静态回本年限、毛租金收益率（挂牌口径，非成交锚点）',
    ],
    verify: [
      '住建官方备案成交明细或可复核的真实成交锚点',
      '同小区同面积段的挂牌租金样本（挂牌数据档、带 as_of）',
      '近 90 天成交套数、在售套数与去化信号',
    ],
    scenario: '现金流与抗跌优先；必要时牺牲自住品质与短期溢价',
  },
  owner_occupy: {
    label: '自住',
    deep_dive: [
      'Location：配套四支柱（学区/商业/医疗/交通）与推车生活圈实测',
      'Property：户型工程与得房率、电梯×楼层交叉、适老与婴幼儿适配',
    ],
    verify: [
      '高德地图实测步行距离与早晚高峰通勤耗时',
      '三甲/儿科急诊与社区卫生服务距离、商业配套分级',
      '产证套内面积与户型图、电梯与楼层实况、物业与车位',
    ],
    scenario: '居住体验优先；必要时牺牲升值想象与面积尺度',
  },
};

// 缺失或未知主诉求一律按「未定义需求」处理，不猜、不默认某个诉求。
// 两个分支返回同一组键，调用方取任何字段都不会拿到 undefined。
export function routeFor(primaryGoal) {
  const key = String(primaryGoal ?? '').trim();
  if (!key || !(key in INTENT_ROUTES)) {
    return {
      status: 'not_defined',
      primary_goal: null,
      label: null,
      deep_dive: [],
      verify: [],
      scenario: '',
      hint: '主诉求未定义 → 按「未定义需求」处理，报告顶部提示先运行 /house-ops intake',
    };
  }
  return { status: 'ok', primary_goal: key, ...INTENT_ROUTES[key], hint: '' };
}
