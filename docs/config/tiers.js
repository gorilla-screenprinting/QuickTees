// /docs/config/tiers.js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();                // CommonJS
  } else {
    root.deriveDtfTier = factory().deriveDtfTier; // Browser global: window.deriveDtfTier
  }
})(typeof self !== 'undefined' ? self : this, function () {

  function deriveDtfTierFromInches(readout) {
    if (!readout || typeof readout.w_in !== 'number' || typeof readout.h_in !== 'number') {
      return { tierIn: 8, key: 'dtf-8', tooLarge: false }; // safe default
    }
    const maxIn = Math.max(readout.w_in, readout.h_in);
    if (maxIn <= 4)  return { tierIn: 4,  key: 'dtf-4',  tooLarge: false };
    if (maxIn <= 8)  return { tierIn: 8,  key: 'dtf-8',  tooLarge: false };
    if (maxIn <= 12) return { tierIn: 12, key: 'dtf-12', tooLarge: false };
    if (maxIn <= 16) return { tierIn: 16, key: 'dtf-16', tooLarge: false };
    return { tierIn: null, key: null, tooLarge: true };
  }

  return { deriveDtfTier: deriveDtfTierFromInches };
});
