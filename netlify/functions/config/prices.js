// netlify/functions/config/prices.js  (CommonJS for Netlify Functions)

const GARMENT_PRICE_IDS = {
  'tee-heavy-black': 'price_1SRyszRe09hrif0dYrQCdob7', // Premium Black Tee — $25
  'tee-heavy-white': 'price_1SRzphRe09hrif0dTLzB3Z7l', // Premium White Tee — $25
  'tee-light-black': 'price_1SRzvyRe09hrif0dqDfAbJjY', // Value Black Tee   — $15
  'tee-light-white': 'price_1SRytQRe09hrif0dN2HAQXLh', // Value White Tee   — $15
};

const DTF_PRICE_IDS = {
  // Small (≈4")
  'dtf-4-front':  'price_1SS0N4Re09hrif0dUQ4Nedlg',
  'dtf-4-back':   'price_1SS0NmRe09hrif0d3H93dom9',

  // Medium (≈8")
  'dtf-8-front':  'price_1SS0Q4Re09hrif0dsJce5NlL',
  'dtf-8-back':   'price_1SS0RhRe09hrif0dPduMgiiG',

  // Large (≈12")
  'dtf-12-front': 'price_1SS0SWRe09hrif0daEkBRtvy',
  'dtf-12-back':  'price_1SS0T3Re09hrif0dr4mrHL42',

  // X-Large (≈16")
  'dtf-16-front': 'price_1SS0U4Re09hrif0dqa6r9brH',
  'dtf-16-back':  'price_1SS0VIRe09hrif0dmleT9ilq',
};

module.exports = { GARMENT_PRICE_IDS, DTF_PRICE_IDS };
