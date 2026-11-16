'use strict';
// Storefront price band: every product is priced between ₹199 and ₹499, ending in 9, preserving the original price order.
const MIN = 199, MAX = 499;
function makeMapper(usdList) {
  const v = usdList.filter((n) => Number.isFinite(n) && n > 0).map(Math.log);
  const lo = Math.min(...v), hi = Math.max(...v);
  return (usd) => {
    const t = hi > lo ? (Math.log(Math.max(usd, 1)) - lo) / (hi - lo) : 0;
    const raw = MIN + t * (MAX - MIN);
    return Math.min(MAX, Math.max(MIN, Math.round(raw / 10) * 10 - 1)); // 199, 209 … 499
  };
}
module.exports = { MIN, MAX, makeMapper };
