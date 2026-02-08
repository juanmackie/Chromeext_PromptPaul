# Unified Multimodal Context Menu Implementation

## Summary
This implementation replaces the segregated media-only context menus (`Analyze Image/Video/Audio`) with a unified instruction system that works across all modalities (text, image, video, audio).

## Changes Made

### background.js

#### Menu Creation
- **Removed**: Old media-specific menu trees (`imageAnalysis`, `videoAnalysis`, `audioAnalysis`, `analyzeImage`, `summarizeImage`, `explainImage`, `imageCustom_*`)
- **Added**: Unified `createUnifiedMenus()` function that creates menus for all modalities:
  - `oneoff_instruction` - contexts: `['selection', 'image', 'video', 'audio']`
  - `start_chat` - contexts: `['selection', 'image', 'video', 'audio']`
  - `prompt_paul` (parent) - contexts: `['selection', 'image', 'video', 'audio']`
    - Predefined actions: `summarize`, `analyze`, `explain`, `polish`, `shorten`, `formal`, `casual`
  - `customInstructions` (parent) - contexts: `['selection', 'image', 'video', 'audio']`
  - `separator` + `manageInstructions` - contexts: `['selection', 'image', 'video', 'audio']`

#### Click Handler
- **Unified** `chrome.contextMenus.onClicked` handler:
  - Detects media context from `info.mediaType` and `info.srcUrl`
  - Loads media as base64 (same flow as previous right-click image analysis)
  - Normalizes `selectedText` to empty string to avoid `undefined` bug
  - Routes all instruction types (one-off, predefined, custom) through unified logic
  - Supports compatibility mode: video/audio included in prompt as metadata

#### Prompt Templates
- **Modality-neutral** prompts in `commandMap`:
  - Changed from "following text" → "following content"
  - Works for both text and media inputs
  - Example: "Please summarize the following content into a bullet list of key points"

#### Storage Sync
- **Updated** `chrome.storage.onChanged` listener:
  - Removes all unified menu items on instruction changes
  - Calls `createUnifiedMenus()` to rebuild
  - Handles `imageCustom_*` IDs from old storage data

#### Removed Functions
- `parseMediaMenuItem()` - No longer needed
- `updateImageCustomInstructions()` - Replaced by unified menu creation
- Old media-specific click handlers - Replaced by unified handler

### chat.js

#### Message Handling
- **Updated** `setSelectedText` action handler:
  - Accepts `mediaData` parameter from background
  - Loads media preview when media is attached
  - Shows appropriate error/success messages
  - Preserves existing text-only flow

#### One-off Submit
- **Refactored** `submitBtn` click handler:
  - **Removed**: Duplicate API request logic (~150 lines)
  - **Added**: Uses shared `makeApiCall()` function for consistency
  - **Media handling**:
    - Detects `currentMediaData`
    - For images: Attaches as native multimodal content (`image_url` type)
    - For video/audio: Adds compatibility mode metadata to prompt
    - Disables streaming for media in compatibility mode
  - **Text-only**: Falls back to existing `makeApiCall()` for text instructions
  - **Tool support**: Properly forwards tool choice from custom instructions

#### Media Preview
- **Existing** `addMediaPreview()` function preserved:
  - Shows image, video, or audio preview in chat
  - Displays loading states and errors
  - Used by both context menu and one-off actions

## Behavior Changes

### Before
- Separate menu trees for text vs. media
- Image right-click → "Analyze Image with Prompt Paul" → predefined actions
- Video/audio right-click → Only "General Analysis"
- One-off on image → Text "Image URL: ..." in prompt (with `undefined` suffix)

### After
- **Unified menu** across all contexts
- **Any** right-click (text/image/video/audio) → Same instruction options
- One-off on image → Loads actual media (base64) → Works like current image analysis
- One-off on video/audio → Loads media → Compatibility mode in prompt
- No `undefined` in prompts (proper string normalization)

## Compatibility Mode

For video/audio providers that don't support native multimodal payloads:
- Media is loaded and previewed in chat
- Type, MIME type, and URL included in prompt text
- Streaming disabled for media requests
- Maintains user experience while working with provider limitations

## Testing Checklist

- [x] Right-click image → One-off Instruction loads media preview, no `undefined`
- [x] Right-click image/video/audio → Predefined and custom actions all execute
- [x] Right-click text selection → Existing behavior unchanged
- [x] Updating instructions in options → Context menus refresh correctly
- [x] Prompts are modality-neutral ("following content" not "following text")
- [x] Tools work with media in one-off flow
- [x] No references to old media menu IDs remaining

## Migration Notes

This is a **breaking change** for users relying on old media-specific menus:
- Old `Analyze Image with Prompt Paul` → Replaced by `Query Prompt Paul` → `Analyze`
- Old `Analyze Video/Audio` → Replaced by unified menu
- All instructions still available, just under one menu structure

Users will see unified menus after extension reload/upgrade.
