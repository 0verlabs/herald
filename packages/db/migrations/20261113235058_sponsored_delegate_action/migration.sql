-- One relayed approval per sponsored Sweep (ADR 0008, ADR 0010). Generated
-- by drizzle-kit; the comments are added by hand.
--
-- Two signed delegate actions for one Sweep, presented at once (two tabs, a
-- re-sign), could both be relayed: Herald paid for two MPC `sign` calls.
-- Herald now takes the first one presented here before relaying it, and
-- relays only that one for the Sweep. Cleared when the relayer refused it,
-- sending nothing. Null for every existing row and every Sweep the
-- Provider's wallet sent.
ALTER TABLE `sweeps` ADD `sponsored_delegate_action` text;
