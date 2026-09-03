# 📌 Issue Preview: refactor: rename ambiguous variable names in components/common

**Labels:** `refactor`, `readability`, `low-risk`

---

### Description
Some variables in `components/common` may use single-letter or overly generic names (`data`, `val`, `x`) that make the code harder to skim. Renaming them to something descriptive improves readability without changing behavior. No logic changes should be involved — this is purely a naming pass.

### Files Involved
- [components/common/empty-state.tsx](components/common/empty-state.tsx)
- [components/common/file-upload.tsx](components/common/file-upload.tsx)
- [components/common/search-input.tsx](components/common/search-input.tsx)
- [components/common/social-share.tsx](components/common/social-share.tsx)

### Action Items
- [ ] Grep each file in `components/common` for single-letter or generic identifiers (`data`, `val`, `x`, `e` outside event handlers, `i`/`j` outside loop counters, etc.)
- [ ] Rename to descriptive names that reflect the value's purpose
- [ ] Repo-wide search for any external references to the old names (props, exports) and update them too
- [ ] Run the existing test suite unmodified to confirm no behavior changed
- [ ] Keep the diff scoped to naming only — no logic or formatting changes
