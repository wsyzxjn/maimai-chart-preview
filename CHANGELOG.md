# Changelog

All notable changes to this extension will be documented in this file.

## 0.1.0 - 2026-10-07

- Initial preview release.
- Supported custom numeric Simai chart sections, preserved their level/designer metadata, identified unsectioned charts as Single Chart, and reported empty, invalid, or duplicate sections explicitly.
- Persisted Follow Playback across preview reopening and window reloads without resetting it on difficulty changes.
- Corrected Simai difficulty labels to EASY through Re:MASTER, removed the incorrect Original label, and displayed declared chart levels.
- Refined playback controls with the engine's original Note speed range of 3.0 to 9.0 in 0.1 increments, clear follow status, current/total time and seek previews, wider volume sliders, and a separate timing settings panel.
- Added conservative content detection for plaintext `.txt` Simai and MA2 charts, preserving explicit file associations and language choices.
- Named the extension maimai Chart Preview (`maimai-chart-preview`) and set the publisher to Amatsuka.
- Added MA2 preview, syntax highlighting, playback, and editor cursor synchronisation.
- Kept the engine's original sound scheduling and implemented SE unmute recovery in the preview using the existing reset API.
- Fixed playback-follow updates causing unintended seeks and interrupting sustained sounds. Playback now follows with line highlighting and scrolling without moving the editor caret.
- Limited automatic cursor seeking to the selected difficulty while paused, added a Follow Playback toggle, and added Play from Cursor for explicit difficulty switching and playback.
- Replaced separate answer and judgment volume controls with Music volume and one master SE volume for all chart sound effects.
- Added Simai syntax highlighting and snippets.
- Added real-time chart preview with difficulty switching.
- Added playback controls, accompaniment lookup, hit sounds, and editor cursor synchronisation.
- Added Note Hi-Speed control. This changes note falling speed; it does not change audio playback speed.
