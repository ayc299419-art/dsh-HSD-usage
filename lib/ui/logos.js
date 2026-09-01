// 供应商小 logo（内联 SVG，按品牌色 16px 圆角标）
// 说明：离线环境拿不到官方矢量素材，用品牌色 + 首字/首字母的圆角标近似：
//   火山方舟 → 品牌红橙 #FF4A00 + "火"；智谱 → 品牌蓝紫 #3859FF + "Z"；DeepSeek → 品牌蓝 #4D6BFE + 鲸鱼曲线
const badge = (bg, inner) =>
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
  '<rect x="1" y="1" width="22" height="22" rx="6" fill="' + bg + '"/>' + inner + '</svg>';

const LOGOS = {
  volcano: badge("#FF4A00",
    '<text x="12" y="17.2" font-size="13" font-weight="700" fill="#fff" text-anchor="middle" font-family="PingFang SC, Hiragino Sans GB, sans-serif">火</text>'),
  zhipu: badge("#3859FF",
    '<text x="12" y="17.5" font-size="14" font-weight="700" fill="#fff" text-anchor="middle" font-family="Arial, sans-serif">Z</text>'),
  deepseek: badge("#4D6BFE",
    '<path d="M6 15.5c0-4 2.6-7 6.5-7 2.2 0 3.9 1 4.8 2.6l1.7-1v6.4l-1.7-1c-.9 1.6-2.6 2.6-4.8 2.6H8.6c-.9 0-1.6-.4-2.1-1l1-1.2z" fill="#fff"/>' +
    '<circle cx="15.2" cy="11.6" r=".9" fill="#4D6BFE"/>')
};

// 未收录的类型：灰底 + 类型首字母
export function providerLogo(type) {
  const svg = LOGOS[type];
  if (svg) return svg;
  const letter = String(type || "?").charAt(0).toUpperCase();
  return badge("#8a8f98",
    '<text x="12" y="17" font-size="13" font-weight="700" fill="#fff" text-anchor="middle" font-family="Arial, sans-serif">' + letter + '</text>');
}
