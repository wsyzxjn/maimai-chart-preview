# maimai Chart Preview for VS Code

Preview and play maimai DX charts in Simai and MA2 formats while you edit them in Visual Studio Code.

By Amatsuka.

## Features

- Live Canvas preview for `.simai`, `.maidata`, `maidata.txt`, and `.ma2` files.
- Automatic Simai and MA2 content detection for other plaintext `.txt` files.
- Tap, Break, Hold, Slide, Wifi, Touch, Touch Hold, and Firework rendering.
- Switch between chart difficulties found in the same file.
- Play, pause, seek, and step through the chart by beat or measure.
- Optional accompaniment lookup beside the chart file:
  `track.mp3`, `track.wav`, `track.ogg`, `bgm.mp3`, `music.mp3`, or `audio.mp3`.
- Two independent volume controls: **Music** for accompaniment and **SE** for all chart sound effects, including answer, judgment, and sustained sounds.
- Hit sounds and Touch Hold scheduling follow the shared engine's playback rules. The preview uses its existing reset API to resume eligible sounds after seeking or unmuting.
- Timing offset adjustment for hit sounds.
- Note Hi-Speed from `3.0` to `9.0` in `0.1` increments, with a slider and direct numeric input.
- Simai metadata completion: type `&` to insert `&title=`, `&artist=`, `&des=`, `&bpm=`, or `&first=`, with the cursor left after `=`.
- Simai snippets for a chart header (`simai-header`), BPM changes (`bpm`), and beat divisors (`div`), plus bracket auto-closing.

Hi-Speed changes the falling speed of notes on screen. It does not change the playback speed of the accompaniment or hit sounds; audio remains at `1.0x`.

## Getting started

1. Open a `.simai`, `.maidata`, `maidata.txt`, or `.ma2` chart file.
2. Select **maimai: Open Chart Preview to Side** from the Command Palette, or use the preview button in the editor title bar.
3. Press **Space** in the preview to play or pause.
4. Use the timeline to seek. Use **Left** and **Right** to step by one beat; hold **Shift** to step by one measure.

The timeline shows the current time and total chart duration. Hover or drag to preview a target time; dragging pauses playback and resumes it when you release if it was playing before. On narrow panes, click **Speed** to expand the Note speed controls. The **Playback Settings** gear contains the SE timing offset in milliseconds. Music and SE retain separate volume sliders.

While paused, `maimai.preview.autoSyncCursor` lets you seek by clicking a body line in the selected difficulty. Clicking another difficulty, metadata, or a blank line leaves the preview unchanged. While playing, moving the editor cursor never seeks or changes difficulty.

Playback highlights the current chart line without moving your caret. The **Follow Playback** target button controls automatic scrolling. Clicking or scrolling the chart editor during playback suspends automatic scrolling so you can browse freely; click the target button to resume. The last follow state is saved for this VS Code profile and restored after reopening the preview or reloading the window; switching charts or difficulties does not force it on. Returning focus to the same chart editor does not interrupt playback.

Selecting a difficulty in the preview pauses playback and reveals that difficulty's body in the editor. To audition a different section directly, place your cursor on a chart body line and run **maimai: Play from Cursor** from the Command Palette or editor context menu. It selects the difficulty enclosing the cursor and plays from that line.

## Settings

The following settings are available under **maimai Chart Preview**:

- `maimai.preview.autoSyncCursor`
- `maimai.preview.autoDetectCharts`
- `maimai.preview.defaultHiSpeed`
- `maimai.preview.judgmentLineDesign`
- `maimai.preview.showFireworks`
- `maimai.preview.enableHitsound`
- `maimai.preview.musicVolume`
- `maimai.preview.seVolume`
- `maimai.preview.timingOffsetMs`

## Supported files

The extension reads Simai and MA2 chart text and reports parse errors in the VS Code Problems panel. Both formats support syntax highlighting, playback, hit sounds, and editor cursor synchronisation.

Simai `//` and `/* ... */` comments in chart bodies are ignored without changing note positions or beats; metadata values such as URLs remain literal. Unknown Note tokens, incomplete Slide paths, invalid time parameters, and malformed MA2 records are reported as errors instead of silently omitted. When a source location is available, the Problems panel marks that line or token, and diagnostics cover every difficulty while the document is edited—no preview is required. A section that never declares a valid BPM is reported on its `&inote_n=` declaration line. Completion is limited to Simai metadata keys: typing `&` offers `&title=`, `&artist=`, `&des=`, `&bpm=`, and `&first=`; note-level templates are not offered.

Standard chart extensions and `maidata.txt` are recognised by name. Other `.txt` files are recognised from combined chart signatures while they are open in Plain Text mode. Detection enables the chart language, syntax highlighting, and preview button without renaming the file. It reads only the first 64 KiB and also checks while you type; unfinished charts may be recognised before they parse successfully. Ordinary prose and Markdown fenced examples are left alone.

Set `maimai.preview.autoDetectCharts` to `false` to disable automatic detection. Explicit `files.associations` and other language modes take precedence. If you change a detected document's language manually, automatic detection will not take it back during the current extension session. The preview command can still inspect a plaintext `.txt` chart when you explicitly invoke it.

Simai files can contain multiple difficulty sections. Their standard numbering is `&inote_1` = EASY, `2` = BASIC, `3` = ADVANCED, `4` = EXPERT, `5` = MASTER, and `6` = Re:MASTER. The difficulty menu uses the shared engine's names and includes each section's level when declared.

Custom positive integer section IDs such as `&inote_7` and `&inote_10` are supported throughout preview, content detection, and cursor playback. The menu identifies them as **谱面 7 / 谱面 10** (Chart 7 / Chart 10), without assigning a standard difficulty name. Matching `&lv_7` / `&des_7` metadata is preserved. A chart with no numbered sections displays **单谱面** (Single Chart). Empty sections, invalid IDs, and duplicate declarations produce explicit parse errors instead of silently skipping or merging chart content.

Each MA2 file represents one chart, so its difficulty selector displays **MA2** and is disabled. Open another MA2 file to preview another chart. MA2 cursor synchronisation uses each record's bar and tick fields and follows the shared parser's four-beat lead-in. Records need not be sorted by time in the file.

MA2 support uses the shared chart engine for note variants, slide paths, BPM changes, and touch notes. It does not convert charts or resolve a song database or ACB/AWB audio banks. Supply an MP3, WAV, or OGG accompaniment using one of the supported filenames beside your MA2 file.

Accompaniment is discovered locally beside the chart; no accompaniment file is downloaded by the extension.

## Privacy and permissions

The extension does not require an account and does not send chart contents to a remote service. It reads the active chart, local accompaniment files, and its bundled rendering and hit-sound assets through VS Code's extension APIs.

## Build from source

Use Node.js 22.14 or later and Corepack with the Yarn version specified in `package.json`:

```bash
corepack enable
yarn install --immutable
yarn test
yarn typecheck
yarn build
```

The chart engine is installed from a pinned Git commit in the upstream Yarn workspace. A checked-in Yarn patch contains Webview resource support and custom Simai section handling. The engine's original sound scheduling and Hi-Speed range are preserved. No sibling checkout is required. See `CONTRIBUTING.md` for updating the dependency.

Chart sounds and the sensor image are included in `media/assets/chart/`. To generate a local VSIX:

```bash
yarn package
```

Packaging checks that required runtime assets are present. To replace them for local testing, `yarn assets:import /absolute/path/to/chart-assets` copies the expected filenames from another directory. Check `git diff` before committing any asset replacements.

## Support

Report problems or request features in [GitHub Issues](https://github.com/wsyzxjn/maimai-chart-preview/issues). See `SUPPORT.md` for useful diagnostic details.

## License

The extension source is distributed under the MIT License. See the included `LICENSE` file.

Bundled assets and dependencies have separate notices. See `THIRD_PARTY_NOTICES.md` and `licenses/`; the source license does not relicense third-party material.
