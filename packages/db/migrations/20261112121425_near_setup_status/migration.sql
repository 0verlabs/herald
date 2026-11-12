-- Where each Provider's NEAR Receiving Address setup stands (spec #30):
-- Herald's NEAR chain queue creates the implicit account and registers it on
-- USDC. Existing rows start at `not_queued`, like new ones: sign-in hands the
-- setup to the queue for every Provider whose status isn't `created`
-- (`ensureNearSetupQueued` in @herald/core/server), so each existing
-- Provider is set up once, at its next sign-in.
ALTER TABLE `providers` ADD `near_setup_status` text DEFAULT 'not_queued' NOT NULL;
