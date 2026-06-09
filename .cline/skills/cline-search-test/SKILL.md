---
name: cline-search-test
description: Use when comparing regex search_files and semantic_search inside the Cline repository.
---

When this skill is active:

1. First use `search_files` for an exact symbol or tool name.
2. Then use `semantic_search` for a behavior-level query.
3. Compare the results by precision, recall, and when each tool is better.
4. Include the phrase `SKILL_ACTIVE_CLINE_SEARCH_TEST` in the final answer.
