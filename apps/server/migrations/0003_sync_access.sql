-- Who has sync on a server that sells it (src/billing.ts). One row for each account the server
-- has seen while selling: its gift of free sync, if any, its Stripe customer, and its subscription's
-- state and dates. Never card details, and nothing from anyone's job hunt. A server of your own
-- never sells sync, so it stays empty.

create table "syncAccess" ("account" text not null primary key references "user" ("id") on delete cascade, "gift" text, "customer" text, "subscription" text, "status" text, "renewsAt" text, "canceling" integer not null default 0, "checkedAt" text, "checkoutAt" text, "updatedAt" text not null);

create index "syncAccess_customer_idx" on "syncAccess" ("customer");

-- Emails given free sync before they had an account. It starts when an account signs up with one,
-- verified, and the email is then forgotten.
create table "freeSyncEmail" ("email" text not null primary key, "since" text not null);
