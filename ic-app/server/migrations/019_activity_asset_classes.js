// Family Planning Activities need both a liquidity-category tag (decrease_class /
// increase_class — Cash/Highly Liquid/Medium Liquidity/Low Liquidity, added in migration
// 003 and repurposed for the A4 liquidity ladder) AND an IPS asset-class tag, since the
// two don't map 1:1 (e.g. two Private Credit funds can carry very different liquidity).
// This adds the asset-class pair, read by getEffectivePort() for Section A's
// allocation/IPS-band checks.
module.exports = function (db) {
  const cols = db.prepare('PRAGMA table_info(activities)').all().map((c) => c.name);
  if (!cols.includes('decrease_asset_class')) db.exec('ALTER TABLE activities ADD COLUMN decrease_asset_class TEXT');
  if (!cols.includes('increase_asset_class')) db.exec('ALTER TABLE activities ADD COLUMN increase_asset_class TEXT');
};
