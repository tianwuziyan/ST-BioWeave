# Audit execution checklist

1. Capture clean status, commit metadata, and relevant file lists.
2. Diff named prompt symbols and classify every changed prompt sentence/structure.
3. Diff and trace Event/Character pipeline symbols across baseline/current.
4. Locate exact count/readiness conditions and the introducing commit.
5. Inventory existing diagnostics and identify the earliest stage without an equivalent count.
6. Run bounded static checks/tests only where useful for evidence; do not modify files.
7. Produce A-J report with file/line anchors, confidence, and minimum repair location.

Validation commands are read-only: `git diff`, `git show`, `git log -S/-G`, `rg`, `sed`, `node --check` only if needed, and existing test commands only if they do not write artifacts.
