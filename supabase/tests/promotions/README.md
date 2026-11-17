# Promotion and referral database tests

Acceptance tests for `20261126001_promotions.sql`, `20261126002_referrals.sql` and
`20261126003_promotion_referral_books.sql`, run against a real Postgres built from the migrations.
They sign in as an owner, manager, cashier and rider (role `authenticated` + JWT claims), so
row-level security and permissions are exercised the way the app hits them.

```bash
# needs a running local Supabase stack (any project); the tests use their own database "promo_test"
C=supabase_db_isms-seedtest bash supabase/tests/promotions/rebuild.sh
C=supabase_db_isms-seedtest bash supabase/tests/promotions/promotions_test.sh   # run first
C=supabase_db_isms-seedtest bash supabase/tests/promotions/referrals_test.sh    # uses the state after it
```

Rebuild before every run: the two scripts expect a fresh database, in that order.
