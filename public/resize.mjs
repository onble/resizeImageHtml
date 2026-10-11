// Interface mode registry only. Dimensions and image processing are planned by Python.
export const MODES = [
  { id: 'height', icon: '↕', title: '按高度', description: '宽度等比变化' },
  { id: 'width', icon: '↔', title: '按宽度', description: '高度等比变化' },
  { id: 'exact', icon: '▣', title: '指定尺寸', description: '拉伸 / 留白 / 裁切' },
  { id: 'percent', icon: '%', title: '按百分比', description: '整体等比缩放' },
  { id: 'fit', icon: '⛶', title: '限定范围', description: '等比放进尺寸内' }
];
