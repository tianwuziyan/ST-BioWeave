# Reference research: ST-SevenDaysCal `snapshot.js`

Source: <https://github.com/atonal519/ST-SevenDaysCal/blob/master/snapshot.js>

The reference implementation treats a snapshot as a property of the message
Floor, not as a separate Chat-level historical record. Its comments and helper
functions establish three relevant rules:

1. A normal message stores the snapshot in `message.extra`.
2. A message with Swipe structure stores the durable value in
   `message.swipe_info[swipe_id].extra`; the active message `extra` is a mirror
   kept in sync with the current Swipe because SillyTavern exposes that active
   projection when switching Swipes.
3. The message/Swipe lifecycle owns deletion and replacement, so an array
   position is not treated as a permanent Floor ID in an independent database.

BioWeave applies the same ownership boundary to `analysis`, `events`, and
analysis-derived projections: reads are scoped to the current Chat/message/
active Swipe/version, while Chat metadata is rebuilt as a materialized view.
