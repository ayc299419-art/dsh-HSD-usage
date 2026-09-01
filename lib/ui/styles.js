// 组件样式：使用 DeepSeekHarness 主题 CSS 变量（与真实主题一致，含兜底值）。
// 注意：浅色主题下 --dsw-alias-label-primary 是深色，背景必须用同族变量，否则深底深字看不见。
export const CSS = `
.dum-root {
  --dum-blue: #4A90E2;
  --dum-green: #50C878;
  --dum-orange: #FF8C42;
  box-sizing: border-box;
  width: 100%;
  padding: 8px 10px 10px;
  margin: 0 0 8px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.25));
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,.06));
  color: var(--dsw-alias-label-primary, #1f2328);
  font-size: 12px;
  line-height: 1.4;
  font-family: var(--ds-font-family-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
}
.dum-root * { box-sizing: border-box; }
.dum-root .dum-toolbar { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
.dum-root .dum-btn {
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.3));
  background: var(--dsw-alias-button-elevated-fill, rgba(128,128,128,.08));
  color: var(--dsw-alias-label-primary, inherit);
  border-radius: 6px;
  font-size: 11px;
  line-height: 1;
  padding: 5px 8px;
  cursor: pointer;
  white-space: nowrap;
}
.dum-root .dum-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.16)); }

.dum-root .dum-item { position: relative; padding: 4px 0; }
.dum-root .dum-main { display: flex; align-items: center; gap: 6px; min-width: 0; }
.dum-root .dum-logo { flex: none; width: 15px; height: 15px; border-radius: 4px; overflow: hidden; display: inline-flex; }
.dum-root .dum-logo svg { width: 100%; height: 100%; display: block; }
.dum-root .dum-name { flex: none; max-width: 40%; font-weight: 600; font-size: 11px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.dum-root .dum-main .dum-bar-row.dum-bar-main { flex: 1 1 auto; min-width: 0; }
.dum-root .dum-refresh-one { flex: none; background: none; border: none; color: var(--dsw-alias-label-secondary,#666); cursor: pointer; font-size: 12px; padding: 0 2px; }
.dum-root .dum-refresh-one:hover { color: var(--dsw-alias-label-primary,#1f2328); }

/* 周/月细柱行：默认隐藏，悬停实例行时展开 */
.dum-root .dum-alt-rows { display: none; flex-direction: column; gap: 3px; padding: 3px 0 2px 24px; }
.dum-root .dum-item:hover .dum-alt-rows { display: flex; }
.dum-root .dum-alt-label { flex: none; width: 18px; font-size: 10px; opacity: .7; text-align: right; }

.dum-root .dum-bar-row { position: relative; display: flex; align-items: center; min-width: 0; }
.dum-root .dum-bar {
  position: relative;
  height: 14px;
  border-radius: 3px;
  min-width: 0;
  overflow: hidden;
  transition: width .35s ease;
  background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.14));
}
.dum-root .dum-bar.dum-thin { height: 7px; }
.dum-root .dum-bar.dum-na { background: #888; opacity: .55; }
.dum-root .dum-bar-fill { position: absolute; inset: 0; opacity: .9; }
.dum-root .dum-bar-value {
  position: relative;
  padding: 0 5px;
  font-size: 10px;
  color: var(--dsw-alias-label-primary, #1f2328);
  white-space: nowrap;
  line-height: 14px;
  text-shadow: 0 1px 2px rgba(255,255,255,.35);
  display: flex; align-items: center;
}
.dum-root .dum-bar.dum-thin .dum-bar-value { line-height: 7px; font-size: 9px; }
.dum-root .dum-bar.dum-na .dum-bar-value { color: #eee; text-shadow: none; }
.dum-root .dum-bar-label { margin-left: 6px; font-size: 10px; opacity: .75; flex: none; }

.dum-root .dum-loading { text-align: center; opacity: .6; padding: 6px 0; font-size: 11px; }
.dum-root .dum-status { margin-top: 6px; padding-top: 5px; border-top: 1px dashed var(--dsw-alias-border-l2, rgba(128,128,128,.2)); font-size: 10px; opacity: .55; }

/* 悬停提示 */
.dum-root .dum-tooltip {
  visibility: hidden; opacity: 0;
  position: absolute; left: 0; right: 0; top: calc(100% + 4px);
  z-index: 999;
  background: var(--dsw-alias-bg-layer-3, #fff);
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.4));
  border-radius: 8px;
  padding: 8px 10px;
  box-shadow: 0 4px 16px rgba(0,0,0,.35);
  transition: opacity .15s ease;
  pointer-events: none;
  font-size: 11px;
  color: var(--dsw-alias-label-primary, #1f2328);
}
.dum-root .dum-item:hover .dum-tooltip { visibility: visible; opacity: 1; }
.dum-root .dum-tooltip-title { font-weight: 600; margin-bottom: 4px; }
.dum-root .dum-tooltip-row { display: flex; justify-content: space-between; gap: 12px; padding: 1px 0; }
.dum-root .dum-tooltip-note { opacity: .7; margin-top: 4px; font-size: 10px; }

/* ---- 设置页区块（渲染在 DSH 设置抽屉内，随主题） ---- */
.dum-sec { display: flex; flex-direction: column; gap: 18px; }
.dum-sec-desc { margin: 0; font-size: 13px; opacity: .75; }
.dum-sec-block { border-top: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.18)); padding-top: 14px; }
.dum-sec-block-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
.dum-sec-title { margin: 0; font-size: 14px; font-weight: 600; }
.dum-sec-page-title { font-size: 16px; font-weight: 700; margin-bottom: 4px; }
.dum-sec-hint { font-size: 12px; opacity: .6; }
.dum-sec-btns { display: flex; gap: 6px; margin-left: auto; }
.dum-sec-btn {
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.35));
  background: var(--dsw-alias-button-elevated-fill, rgba(128,128,128,.08));
  color: var(--dsw-alias-label-primary, inherit);
  border-radius: 6px;
  font-size: 12px;
  line-height: 1;
  padding: 6px 10px;
  cursor: pointer;
  white-space: nowrap;
}
.dum-sec-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.16)); }
.dum-sec-btn.dum-sec-primary { background: var(--dsw-alias-button-primary-fill, #4A90E2); color: var(--dsw-alias-label-primary-inverted, #fff); border-color: transparent; }

.dum-sec-checks { display: flex; flex-direction: column; gap: 6px; }
.dum-sec-check { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.18)); cursor: pointer; }
.dum-sec-check:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.08)); }
.dum-sec-check input[type="checkbox"] { width: 15px; height: 15px; accent-color: var(--dsw-alias-brand-primary, #4A90E2); cursor: pointer; }
.dum-sec-drag { flex: none; cursor: grab; opacity: .45; font-size: 13px; line-height: 1; user-select: none; padding: 0 1px; }
.dum-sec-drag:hover { opacity: 1; }
.dum-sec-check.dum-dragging { opacity: .45; }
.dum-sec-check-name { font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dum-sec-check-type { font-size: 11px; opacity: .65; margin-left: auto; flex: none; }

.dum-sec-list { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
.dum-sec-row { display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 6px; background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,.05)); }
.dum-sec-row-name { font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dum-sec-row-type { font-size: 11px; opacity: .65; flex: none; }
.dum-sec-link { background: none; border: none; color: var(--dsw-alias-brand-primary, #4A90E2); cursor: pointer; font-size: 12px; padding: 2px 4px; }
.dum-sec-danger { color: var(--dsw-alias-state-error-primary, #e5534b); }

.dum-sec-form { display: flex; flex-direction: column; gap: 8px; }
.dum-sec-input {
  box-sizing: border-box;
  width: 100%;
  padding: 7px 9px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.4));
  background: var(--dsw-alias-bg-layer-1, #fff);
  color: var(--dsw-alias-label-primary, #1f2328);
  font-size: 13px;
  font-family: inherit;
}
.dum-sec-field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
.dum-sec-field-label { opacity: .8; }
.dum-sec-field input, .dum-sec-field select {
  box-sizing: border-box;
  width: 100%;
  padding: 7px 9px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.4));
  background: var(--dsw-alias-bg-layer-1, #fff);
  color: var(--dsw-alias-label-primary, #1f2328);
  font-size: 13px;
  font-family: inherit;
}
.dum-sec-form-actions { display: flex; gap: 8px; margin-top: 10px; }
.dum-sec-error { color: var(--dsw-alias-state-error-primary, #e5534b); font-size: 12px; margin-top: 8px; }
.dum-sec-empty { opacity: .6; font-size: 12px; padding: 4px 0; }
`;
