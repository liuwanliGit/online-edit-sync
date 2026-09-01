// 直接调用核心逻辑生成示例报表(不走 MCP 协议,便于快速验证)
// 运行: node test-report.mjs
import { createReportDocx } from './report.mjs'

const result = await createReportDocx({
  title: '2026年第二季度运营报表',
  outputDir: 'output',
  blocks: [
    { type: 'heading', level: 1, text: '2026 年第二季度运营报表' },
    { type: 'paragraph', html: '本季度 <strong>日活跃用户</strong> 达到 128 万,环比增长 <strong>12.3%</strong>,核心指标如下。' },

    { type: 'heading', level: 2, text: '一、核心指标概览' },
    {
      type: 'table',
      headers: ['指标', 'Q1', 'Q2', '环比'],
      aligns: ['left', 'right', 'right', 'center'],
      rows: [
        ['日活跃用户(万)', '114', '128', '+12.3%'],
        ['新增注册(万)', '38.5', '45.2', '+17.4%'],
        ['付费转化率', '3.4%', '3.8%', '+0.4pp'],
        ['次日留存率', '40%', '42%', '+2pp'],
      ],
    },

    { type: 'heading', level: 2, text: '二、分渠道收入明细' },
    {
      type: 'table',
      headers: ['渠道', 'Q1 收入(万元)', 'Q2 收入(万元)', '环比'],
      aligns: ['left', 'right', 'right', 'center'],
      rows: [
        ['线上广告', '1,204', '1,458', '+21.1%'],
        ['会员订阅', '866', '1,020', '+17.8%'],
        ['电商佣金', '512', '598', '+16.8%'],
        ['合计', '2,582', '3,076', '+19.1%'],
      ],
    },

    { type: 'heading', level: 2, text: '三、趋势图' },
    {
      type: 'chart',
      width: 620,
      height: 340,
      alt: 'Q1-Q2 月度 DAU 与收入趋势',
      option: {
        title: { text: '月度 DAU 与收入趋势', left: 'center', textStyle: { fontSize: 14 } },
        tooltip: { trigger: 'axis' },
        legend: { data: ['DAU(万)', '收入(万元)'], bottom: 0 },
        xAxis: { type: 'category', data: ['1月', '2月', '3月', '4月', '5月', '6月'] },
        yAxis: [
          { type: 'value', name: 'DAU(万)' },
          { type: 'value', name: '收入(万元)' },
        ],
        series: [
          { name: 'DAU(万)', type: 'line', smooth: true, data: [108, 112, 122, 124, 129, 131] },
          { name: '收入(万元)', type: 'bar', yAxisIndex: 1, data: [820, 860, 902, 980, 1030, 1066] },
        ],
      },
    },
    {
      type: 'chart',
      width: 620,
      height: 320,
      alt: 'Q2 收入渠道占比',
      option: {
        title: { text: 'Q2 收入渠道占比', left: 'center', textStyle: { fontSize: 14 } },
        tooltip: { trigger: 'item' },
        legend: { bottom: 0 },
        series: [
          {
            type: 'pie',
            radius: ['35%', '62%'],
            label: { formatter: '{b}: {d}%' },
            data: [
              { value: 1458, name: '线上广告' },
              { value: 1020, name: '会员订阅' },
              { value: 598, name: '电商佣金' },
            ],
          },
        ],
      },
    },

    { type: 'heading', level: 2, text: '四、结论与建议' },
    {
      type: 'numbered',
      items: [
        '广告与订阅双轮驱动,Q2 收入环比 +19.1%,建议 Q3 继续加大渠道投放。',
        '次留提升 2pp,与新用户引导改版上线时间吻合,建议全量推广。',
        '电商佣金基数较小但增速稳定,可作为 Q3 第二增长曲线试点。',
      ],
    },
  ],
})

console.log('生成结果:', result)
