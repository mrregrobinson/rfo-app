// Reg was the only admin, which meant no one could recover his account if he lost his
// password or phone. Sheri-Dawn is the other "Required (Core)" G1 founder per the
// original build spec, with equal accountability — she becomes a second admin so there's
// always someone who can issue a reset via the admin panel.
module.exports = function (db) {
  db.prepare("UPDATE users SET is_admin = 1 WHERE id = 'sd'").run();
};
