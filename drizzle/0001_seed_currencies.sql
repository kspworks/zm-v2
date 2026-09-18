-- Fixed ids, kept verbatim from v1 so migrated rows keep pointing at them.
INSERT INTO "currencies" ("id", "code", "sign") VALUES
  ('smea6nsp8t6nrofg7gul2ai6', 'UAH', '₴'),
  ('toegx59plx5s345ddc8kilps', 'USD', '$'),
  ('p7pwusz57z3ndrzbkr2uvdgm', 'EUR', '€'),
  ('mby0x01v764is0rwfrfjegil', 'GBP', '£')
ON CONFLICT ("id") DO NOTHING;
