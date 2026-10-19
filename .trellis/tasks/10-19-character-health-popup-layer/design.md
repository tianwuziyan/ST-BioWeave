# Technical Design

Keep the current Character page HTML and delegated actions. The parent health
popover remains the only presentation layer. The source list is rendered in
normal flow inside the scrollable popover so its height contributes to the
popover scroll area; it no longer relies on an absolutely positioned child
escaping an ancestor overflow boundary. Raise the health popover/source menu
stacking values only as a complementary layer fix.

No new modal, portal, backdrop, state field, DTO, or navigation action is
introduced. Existing Desktop/iPad placement, Mobile bottom placement, close
button, outside click, and Escape priority remain the contract.
