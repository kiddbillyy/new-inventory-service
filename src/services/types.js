function normalizeType(t) {
  const u = String(t || '').toUpperCase();
  if (u === 'GR') return 'EM';
  if (u === 'GI') return 'SM';
  if (u === 'GRPO') return 'EP';
  if (u === 'SORES') return 'FR';
  if (u === 'SOREL') return 'NV';
  return u; // POADD, POREM, TT
}
module.exports = { normalizeType };
