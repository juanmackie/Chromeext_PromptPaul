# Plan: Synchronized Dark Theme Toggle for Sidebar and Options Page

## 1. UI Changes
- **chat.html**: Add a toggle (checkbox or switch) for "Dark Theme" in the sidebar UI.
- **options.html**: Add a toggle (checkbox or switch) for "Dark Theme" in the settings form.

## 2. CSS Changes
- **chat.css** and **options.css**: 
  - Add a `.dark-theme` class to the body.
  - Override CSS variables for dark mode (background, text, surface, border, etc.).

## 3. JavaScript Logic
- **chat.js** and **options.js**:
  - On page load, read `darkTheme` from `chrome.storage.sync` and:
    - Set the toggle state.
    - Add/remove `.dark-theme` on `<body>`.
  - When the toggle is changed:
    - Update `darkTheme` in `chrome.storage.sync`.
    - Add/remove `.dark-theme` on `<body>`.
  - Listen for `chrome.storage.onChanged`:
    - If `darkTheme` changes, update the toggle and theme accordingly (keeps sidebar and options in sync).

## 4. Storage
- Use `chrome.storage.sync` with a key like `{ darkTheme: true/false }`.

---

## Mermaid Diagram

```mermaid
flowchart TD
    subgraph Sidebar (chat.html + chat.js)
        A1[Dark Theme Toggle] --change--> B1[Update chrome.storage.sync]
        B1 --storage.onChanged--> C1[Update UI & Theme]
        B1 --storage.onChanged--> C2[Options Page]
    end

    subgraph Options Page (options.html + options.js)
        A2[Dark Theme Toggle] --change--> B1
        B1 --storage.onChanged--> D1[Update UI & Theme]
        B1 --storage.onChanged--> D2[Sidebar]
    end

    style B1 fill:#f9f,stroke:#333,stroke-width:2px
    style A1 fill:#bbf,stroke:#333,stroke-width:1px
    style A2 fill:#bbf,stroke:#333,stroke-width:1px
    style C1 fill:#bfb,stroke:#333,stroke-width:1px
    style D1 fill:#bfb,stroke:#333,stroke-width:1px
```

---

## Implementation Steps

1. **Add toggle UI** to both chat.html and options.html.
2. **Add .dark-theme CSS** to both chat.css and options.css.
3. **Update JS** in chat.js and options.js to:
    - Read/write `darkTheme` from/to `chrome.storage.sync`.
    - Listen for `chrome.storage.onChanged` to sync theme across both pages.
    - Apply/remove `.dark-theme` on `<body>` as needed.