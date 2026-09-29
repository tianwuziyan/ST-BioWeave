# Implementation Plan

1. Scan current docs, source comments, tests, and archive references for legacy terminology and classify each hit.
2. Compare current normative spec with implementation and prompt contracts; stop on DOC/CODE CONTRACT CONFLICT.
3. Update only stale current documentation/comments/test names or comments. Preserve negative assertions and historical archives.
4. Add concise current architecture/ownership wording where an existing appropriate document already contains the topic; do not create a duplicate large spec.
5. Run source scans, syntax checks for touched JS, focused World Model/debug/API tests, full test if practical, and `git diff --check`.
6. Review diff to ensure no prompt/runtime semantic changes.
