// unknownCategoryId()/transfersCategoryId() in server/expenditure.js used to identify
// the "Miscellaneous/Unknown" and "Transfers" categories by matching their NAME —
// but Manage Categories explicitly supports renaming any category, including these
// two. Rename either one and those lookups silently return null: new transactions stop
// landing in a findable "Unknown" bucket (Research Unknown Payees goes permanently
// empty), and newly-excluded transfers/income lose their category (still correctly
// hidden from spending via is_transfer, but no longer visible as "Transfers" anywhere).
//
// This adds a `role` column that identifies these two categories independently of their
// display name, so they can be renamed (or the whole app localized/relabeled) freely.
// Existing categories are matched by name ONE TIME here to backfill the role that never
// existed before; from then on, role — not name — is authoritative.
module.exports = function (db) {
  db.exec(`ALTER TABLE expenditure_categories ADD COLUMN role TEXT`);
  db.exec(`
    UPDATE expenditure_categories SET role = 'unknown' WHERE role IS NULL AND name = 'Miscellaneous/Unknown';
    UPDATE expenditure_categories SET role = 'transfers' WHERE role IS NULL AND name = 'Transfers';
  `);
};
