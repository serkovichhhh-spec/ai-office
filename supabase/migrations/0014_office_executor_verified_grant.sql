-- AI Office 1.1.3: the owner panel reads executors.verified_at / verified_note (0012) under column-level grants.
grant select (verified_at, verified_note) on office.executors to authenticated;
