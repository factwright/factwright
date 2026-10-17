-- Who has sync on a server that sells it (src/billing.ts). One row for each account that's paid,
-- or that has sync as a gift: "early" for accounts from before sync was sold, "free" for anyone
-- who asked. It keeps Stripe's IDs and the subscription's state and dates, never card details,
-- and nothing from anyone's job hunt. A server of your own never sells sync, so it stays empty.

create table "syncAccess" ("account" text not null primary key references "user" ("id") on delete cascade, "gift" text, "customer" text, "subscription" text, "status" text, "renewsAt" text, "canceling" integer not null default 0, "updatedAt" text not null);

create index "syncAccess_customer_idx" on "syncAccess" ("customer");

-- Emails given free sync before they had an account. It starts when they sign up with one.
create table "freeSyncEmail" ("email" text not null primary key, "since" text not null);
