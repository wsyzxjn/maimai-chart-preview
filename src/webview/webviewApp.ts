import {
  MainRenderer,
  AudioManager,
  ANSWER_SOUND_BASE_OFFSET_MS,
  TimingTimeline,
  DIFFICULTY_NAMES,
  prepareAudioEvents,
} from "@lxns-network/maimai-chart-engine";
import type { Chart, ChartDifficulty, PreparedAudioEvent } from "@lxns-network/maimai-chart-engine";
import type { HostToWebviewMessage, WebviewToHostMessage } from "../types/protocol";

declare function acquireVsCodeApi(): {
  postMessage(msg: WebviewToHostMessage): void;
  getState(): any;
  setState(state: any): void;
};

const vscode = acquireVsCodeApi();

class MaimaiWebviewApp {
  private canvas: HTMLCanvasElement;
  private renderer: MainRenderer | null = null;
  private audioManager: AudioManager | null = null;
  private audioCtx: AudioContext | null = null;
  private seGainNode: GainNode | null = null;
  private musicVolume = 1.0;
  private seVolume = 0.5;

  private chart: Chart | null = null;
  private chartKey = "";
  private documentUri = "";
  private timingTimeline: TimingTimeline | null = null;
  private preparedAudioEvents: PreparedAudioEvent[] = [];

  private isPlaying = false;
  private currentBeats = 0;
  private maxBeats = 0;
  private playbackSpeed = 1.0;
  private hiSpeed = 5.0;
  private isScrubbing = false;
  private resumeAfterScrub = false;

  private lastAnimTime = 0;
  private animFrameId: number | null = null;

  // UI 元素
  private titleEl: HTMLElement;
  private metaEl: HTMLElement;
  private diffSelect: HTMLSelectElement;
  private hiSpeedSlider: HTMLInputElement;
  private hiSpeedValue: HTMLInputElement;
  private hiSpeedLabel: HTMLElement;
  private speedControl: HTMLElement;
  private speedToggleBtn: HTMLButtonElement;
  private playbackSettings: HTMLDetailsElement;
  private timelinePreview: HTMLOutputElement;
  private musicVolumeLabel: HTMLOutputElement;
  private seVolumeLabel: HTMLOutputElement;
  private followPlaybackLabel: HTMLElement;
  private timeDisplay: HTMLElement;
  private timelineSlider: HTMLInputElement;
  private playBtn: HTMLButtonElement;
  private soundToggleBtn: HTMLButtonElement;
  private playIcon: HTMLElement;
  private soundIcon: HTMLElement;
  private musicVolumeInput: HTMLInputElement;
  private seVolumeInput: HTMLInputElement;
  private timingOffset: HTMLInputElement;
  private seekBackBtn: HTMLButtonElement;
  private seekForwardBtn: HTMLButtonElement;
  private errorBanner: HTMLElement;
  private followPlaybackBtn: HTMLButtonElement;
  private followPlayback = true;

  private availableDifficulties: number[] = [4];
  private selectedDifficulty: number = 4;
  private bgmAudio: HTMLAudioElement | null = null;
  private hitsoundEnabled = true;

  constructor() {
    this.canvas = document.getElementById("chartCanvas") as HTMLCanvasElement;
    this.titleEl = document.getElementById("songTitle")!;
    this.metaEl = document.getElementById("songMeta")!;
    this.diffSelect = document.getElementById("diffSelect") as HTMLSelectElement;
    this.hiSpeedSlider = document.getElementById("hiSpeedSlider") as HTMLInputElement;
    this.hiSpeedValue = document.getElementById("hiSpeedValue") as HTMLInputElement;
    this.hiSpeedLabel = document.getElementById("hiSpeedLabel")!;
    this.speedControl = document.getElementById("speedControl")!;
    this.speedToggleBtn = document.getElementById("speedToggleBtn") as HTMLButtonElement;
    this.playbackSettings = document.getElementById("playbackSettings") as HTMLDetailsElement;
    this.timelinePreview = document.getElementById("timelinePreview") as HTMLOutputElement;
    this.musicVolumeLabel = document.getElementById("musicVolumeLabel") as HTMLOutputElement;
    this.seVolumeLabel = document.getElementById("seVolumeLabel") as HTMLOutputElement;
    this.followPlaybackLabel = document.getElementById("followPlaybackLabel")!;
    this.timeDisplay = document.getElementById("timeDisplay")!;
    this.timelineSlider = document.getElementById("timelineSlider") as HTMLInputElement;
    this.playBtn = document.getElementById("playBtn") as HTMLButtonElement;
    this.soundToggleBtn = document.getElementById("soundToggleBtn") as HTMLButtonElement;
    this.playIcon = document.getElementById("playIcon")!;
    this.soundIcon = document.getElementById("soundIcon")!;
    this.musicVolumeInput = document.getElementById("musicVolume") as HTMLInputElement;
    this.seVolumeInput = document.getElementById("seVolume") as HTMLInputElement;
    this.timingOffset = document.getElementById("timingOffset") as HTMLInputElement;
    this.seekBackBtn = document.getElementById("seekBackBtn") as HTMLButtonElement;
    this.seekForwardBtn = document.getElementById("seekForwardBtn") as HTMLButtonElement;
    this.errorBanner = document.getElementById("errorBanner")!;
    this.followPlaybackBtn = document.getElementById("followPlaybackBtn") as HTMLButtonElement;
    this.followPlayback = this.followPlaybackBtn.getAttribute("aria-pressed") === "true";

    this.bindEvents();
    this.initRenderer();

    vscode.postMessage({ type: "ready" });
  }

  private initRenderer() {
    this.renderer = new MainRenderer(this.canvas, {
      sensorImagePath: "",
      showStatistics: true,
    });
    this.renderer.setHiSpeed(this.hiSpeed);
    this.renderer.setJudgmentLineDesign("sensor");
    this.renderer.setShowFireworks(true);
    this.renderer.setShowHitEffect(true);

    this.handleResize();
    window.addEventListener("resize", () => this.handleResize());
  }

  private handleResize() {
    if (this.renderer) {
      this.renderer.resize(false);
      this.renderCurrentFrame();
    }
  }

  private bindEvents() {
    window.addEventListener("message", (event) => {
      this.handleHostMessage(event.data as HostToWebviewMessage);
    });

    this.playBtn.addEventListener("click", () => {
      this.togglePlay();
    });
    this.followPlaybackBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "setFollowPlayback", enabled: !this.followPlayback });
    });

    this.soundToggleBtn.addEventListener("click", () => {
      this.toggleSound();
    });

    this.seekBackBtn.addEventListener("click", () => {
      this.seekTo(Math.max(0, this.currentBeats - 4), false);
    });

    this.seekForwardBtn.addEventListener("click", () => {
      this.seekTo(Math.min(this.maxBeats, this.currentBeats + 4), false);
    });

    this.timelineSlider.addEventListener("input", () => {
      const beat = parseFloat(this.timelineSlider.value);
      this.seekTo(beat, false);
      this.showTimelinePreview(beat);
    });
    this.timelineSlider.addEventListener("pointerdown", () => {
      this.isScrubbing = true;
      this.resumeAfterScrub = this.isPlaying;
      if (this.isPlaying) this.pause();
    });
    window.addEventListener("pointerup", () => {
      if (!this.isScrubbing) return;
      this.isScrubbing = false;
      this.timelinePreview.hidden = true;
      if (this.resumeAfterScrub) void this.startPlay();
      this.resumeAfterScrub = false;
    });
    this.timelineSlider.addEventListener("pointercancel", () => {
      this.isScrubbing = false;
      this.resumeAfterScrub = false;
      this.timelinePreview.hidden = true;
    });
    this.timelineSlider.addEventListener("pointermove", (event) => {
      if (this.isScrubbing) {
        this.showTimelinePreview(Number(this.timelineSlider.value));
      } else {
        const rect = this.timelineSlider.getBoundingClientRect();
        const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        this.showTimelinePreview(fraction * this.maxBeats);
      }
    });
    this.timelineSlider.addEventListener("pointerleave", () => {
      if (!this.isScrubbing) this.timelinePreview.hidden = true;
    });
    this.timelineSlider.addEventListener("blur", () => { this.timelinePreview.hidden = true; });

    this.diffSelect.addEventListener("change", () => {
      const diff = parseInt(this.diffSelect.value, 10);
      this.selectedDifficulty = diff;
      vscode.postMessage({ type: "selectDifficulty", difficulty: diff });
    });

    this.hiSpeedSlider.addEventListener("input", () => {
      this.setHiSpeed(Number(this.hiSpeedSlider.value));
    });
    this.hiSpeedValue.addEventListener("input", () => {
      if (this.hiSpeedValue.value !== "") this.setHiSpeed(this.hiSpeedValue.valueAsNumber, false);
    });
    this.hiSpeedValue.addEventListener("change", () => {
      this.setHiSpeed(this.hiSpeedValue.valueAsNumber);
    });
    this.hiSpeedValue.addEventListener("blur", () => {
      this.setHiSpeed(this.hiSpeedValue.valueAsNumber);
    });
    this.speedToggleBtn.addEventListener("click", () => {
      const expanded = !this.speedControl.classList.contains("expanded");
      this.speedControl.classList.toggle("expanded", expanded);
      this.speedToggleBtn.setAttribute("aria-expanded", String(expanded));
      if (expanded) this.playbackSettings.open = false;
    });
    document.getElementById("settingsCloseBtn")!.addEventListener("click", () => {
      this.playbackSettings.open = false;
      (this.playbackSettings.querySelector("summary") as HTMLElement).focus();
    });
    this.playbackSettings.addEventListener("toggle", () => {
      if (this.playbackSettings.open) {
        this.speedControl.classList.remove("expanded");
        this.speedToggleBtn.setAttribute("aria-expanded", "false");
      }
    });
    document.addEventListener("pointerdown", (event) => {
      const target = event.target as Node;
      if (!this.speedControl.contains(target)) {
        this.speedControl.classList.remove("expanded");
        this.speedToggleBtn.setAttribute("aria-expanded", "false");
      }
      if (!this.playbackSettings.contains(target)) this.playbackSettings.open = false;
    });
    this.musicVolumeInput.addEventListener("input", () => {
      this.musicVolume = parseFloat(this.musicVolumeInput.value);
      if (this.bgmAudio) this.bgmAudio.volume = this.musicVolume;
      this.musicVolumeLabel.textContent = `${Math.round(this.musicVolume * 100)}%`;
    });
    this.seVolumeInput.addEventListener("input", () => {
      this.seVolume = parseFloat(this.seVolumeInput.value);
      if (this.seGainNode) this.seGainNode.gain.value = this.seVolume;
      this.seVolumeLabel.textContent = `${Math.round(this.seVolume * 100)}%`;
    });
    this.timingOffset.addEventListener("input", () => {
      const value = this.timingOffset.valueAsNumber;
      if (Number.isFinite(value)) this.audioManager?.setTimingOffset(ANSWER_SOUND_BASE_OFFSET_MS + Math.max(-500, Math.min(500, value)));
    });
    this.timingOffset.addEventListener("change", () => {
      const value = this.timingOffset.valueAsNumber;
      this.timingOffset.value = String(Number.isFinite(value) ? Math.max(-500, Math.min(500, value)) : 0);
      this.audioManager?.setTimingOffset(ANSWER_SOUND_BASE_OFFSET_MS + Number(this.timingOffset.value));
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (this.speedControl.classList.contains("expanded")) {
          this.speedControl.classList.remove("expanded");
          this.speedToggleBtn.setAttribute("aria-expanded", "false");
          this.speedToggleBtn.focus();
        }
        if (this.playbackSettings.open) {
          this.playbackSettings.open = false;
          (this.playbackSettings.querySelector("summary") as HTMLElement).focus();
        }
        return;
      }
      const target = e.target;
      if (target instanceof HTMLElement && target.closest("input, select, textarea, button, summary, [contenteditable=\"true\"]")) return;
      if (e.code === "Space") {
        e.preventDefault();
        this.togglePlay();
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        this.seekTo(Math.max(0, this.currentBeats - (e.shiftKey ? 4 : 1)), false);
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        this.seekTo(Math.min(this.maxBeats, this.currentBeats + (e.shiftKey ? 4 : 1)), false);
      } else if (e.key === "m" || e.key === "M") {
        this.toggleSound();
      }
    });
  }

  private setHiSpeed(value: number, updateInput = true) {
    if (Number.isFinite(value)) this.hiSpeed = Math.round(Math.max(3, Math.min(9, value)) * 10) / 10;
    this.hiSpeedSlider.value = String(this.hiSpeed);
    if (updateInput) this.hiSpeedValue.value = this.hiSpeed.toFixed(1);
    this.hiSpeedLabel.textContent = this.hiSpeed.toFixed(1);
    this.hiSpeedSlider.setAttribute("aria-valuetext", this.hiSpeed.toFixed(1));
    this.renderer?.setHiSpeed(this.hiSpeed);
    this.renderCurrentFrame();
  }

  private formatTime(beat: number): string {
    const totalSec = Math.max(0, Math.floor((this.timingTimeline?.msFromBeat(beat) ?? 0) / 1000));
    return `${Math.floor(totalSec / 60).toString().padStart(2, "0")}:${(totalSec % 60).toString().padStart(2, "0")}`;
  }

  private showTimelinePreview(beat: number) {
    if (!this.chart) return;
    this.timelinePreview.textContent = this.formatTime(beat);
    const width = this.timelineSlider.clientWidth;
    const fraction = this.maxBeats > 0 ? beat / this.maxBeats : 0;
    this.timelinePreview.style.left = `${Math.max(28, Math.min(width - 28, fraction * width))}px`;
    this.timelinePreview.hidden = false;
  }

  private toggleSound() {
    this.setSoundEnabled(!this.hitsoundEnabled);
  }

  private setSoundEnabled(enabled: boolean) {
    const wasEnabled = this.hitsoundEnabled;
    this.hitsoundEnabled = enabled;
    this.audioManager?.setEnabled(enabled);
    if (enabled && !wasEnabled && this.audioManager && this.timingTimeline) {
      const currentMs = this.timingTimeline.msFromBeat(this.currentBeats);
      this.audioManager.reset(currentMs, true);
      if (this.isPlaying) this.audioManager.schedule(this.preparedAudioEvents, currentMs, this.playbackSpeed);
    }
    this.updateSoundButtonUI();
  }

  private updateSoundButtonUI() {
    this.soundToggleBtn.setAttribute("aria-pressed", String(!this.hitsoundEnabled));
    this.soundToggleBtn.setAttribute("aria-label", this.hitsoundEnabled ? "静音 SE" : "开启 SE");
    if (this.hitsoundEnabled) {
      this.soundIcon.className = "codicon codicon-unmute";
      this.soundToggleBtn.classList.remove("muted");
      this.soundToggleBtn.title = "SE 开 (按键 M)";
    } else {
      this.soundIcon.className = "codicon codicon-mute";
      this.soundToggleBtn.classList.add("muted");
      this.soundToggleBtn.title = "SE 已静音 (按键 M)";
    }
  }

  private async ensureAudioContext() {
    if (!this.audioCtx) {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      this.audioCtx = new AudioCtxClass();
    }
    if (this.audioCtx.state === "suspended") {
      await this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  private async handleHostMessage(msg: HostToWebviewMessage) {
    switch (msg.type) {
      case "init": {
        this.applySettings(msg.settings);
        const ctx = await this.ensureAudioContext();
        this.seGainNode = ctx.createGain();
        this.seGainNode.gain.value = this.seVolume;
        this.seGainNode.connect(ctx.destination);
        this.audioManager = new AudioManager({
          audioContext: ctx,
          outputNode: this.seGainNode,
          soundBaseUrl: new URL(".", msg.assets.answerSoundUrl).href,
          initialVolume: 1.0,
          initialTimingOffset: ANSWER_SOUND_BASE_OFFSET_MS + msg.settings.timingOffsetMs,
        });
        await this.audioManager.init();
        this.audioManager.setEnabled(this.hitsoundEnabled);
        this.audioManager.setJudgeVolume(1.0);

        if (this.renderer && msg.assets.sensorUrl) {
          (this.renderer as any).sensorImage = new Image();
          (this.renderer as any).sensorImage.src = msg.assets.sensorUrl;
        }

        this.audioManager.setTimingOffset(ANSWER_SOUND_BASE_OFFSET_MS + parseFloat(this.timingOffset.value));
        break;
      }

      case "chartUpdate": {
        this.isScrubbing = false;
        this.resumeAfterScrub = false;
        this.timelinePreview.hidden = true;
        const chartKey = `${msg.documentUri}:${msg.selectedDifficulty}`;
        const beat = msg.initialBeat ?? (chartKey === this.chartKey ? this.currentBeats : 0);
        this.chartKey = chartKey;
        this.pause();
        this.documentUri = msg.documentUri;
        if (msg.error) {
          this.showError(msg.error);
        } else {
          this.hideError();
        }

        this.availableDifficulties = msg.availableDifficulties || [4];
        this.selectedDifficulty = msg.selectedDifficulty || 4;
        this.updateDiffSelect(msg.chart, msg.format === "ma2" ? "MA2" : msg.hasDifficultySections === false ? "单谱面" : undefined);
        this.diffSelect.disabled = msg.format === "ma2" || msg.hasDifficultySections === false || this.availableDifficulties.length === 0;
        this.diffSelect.title = msg.format === "ma2" ? "MA2 每个文件包含一张谱面" : msg.hasDifficultySections === false ? "未声明难度的单谱面" : "切换谱面难度";

        if (msg.chart) {
          this.loadChart(msg.chart);
        } else {
          this.chart = null;
          this.timingTimeline = null;
          this.preparedAudioEvents = [];
          this.currentBeats = 0;
          this.maxBeats = 0;
          this.timelineSlider.value = "0";
          this.timeDisplay.textContent = "00:00 / 00:00";
          this.titleEl.textContent = "谱面解析失败";
        }

        if (msg.bgmUri) {
          this.loadBgm(msg.bgmUri);
        } else if (this.bgmAudio) {
          this.bgmAudio.pause();
          this.bgmAudio.removeAttribute("src");
          this.bgmAudio.load();
        }
        if (msg.chart) {
          this.seekTo(beat);
          if (msg.autoPlay) await this.startPlay();
        }
        break;
      }

      case "seekToBeat": {
        if (msg.onlyWhenPaused && this.isPlaying) break;
        this.seekTo(msg.beat, msg.autoPlay ?? false);
        break;
      }

      case "followPlaybackState": {
        this.followPlayback = msg.enabled;
        this.followPlaybackBtn.classList.toggle("active", msg.enabled);
        this.followPlaybackBtn.setAttribute("aria-pressed", String(msg.enabled));
        this.followPlaybackBtn.setAttribute("aria-label", msg.enabled ? "跟随播放已开启" : "跟随播放已停止");
        this.followPlaybackLabel.textContent = msg.enabled ? "跟随中" : "跟随关闭";
        this.followPlaybackBtn.title = msg.enabled ? "跟随播放：自动滚动到当前行" : "跟随已停止：点击恢复自动滚动";
        break;
      }

      case "updateSettings": {
        this.applySettings(msg.settings);
        break;
      }
    }
  }

  private applySettings(settings: any) {
    if (!this.renderer) return;
    if (settings.hiSpeed !== undefined) {
      this.setHiSpeed(settings.hiSpeed);
    }
    if (settings.judgmentLineDesign !== undefined) {
      this.renderer.setJudgmentLineDesign(settings.judgmentLineDesign);
    }
    if (settings.showFireworks !== undefined) {
      this.renderer.setShowFireworks(settings.showFireworks);
    }
    if (settings.enableHitsound !== undefined) {
      this.setSoundEnabled(settings.enableHitsound);
    }
    if (settings.musicVolume !== undefined) {
      this.musicVolume = settings.musicVolume;
      this.musicVolumeInput.value = String(this.musicVolume);
      this.musicVolumeLabel.textContent = `${Math.round(this.musicVolume * 100)}%`;
      if (this.bgmAudio) this.bgmAudio.volume = this.musicVolume;
    }
    if (settings.seVolume !== undefined) {
      this.seVolume = settings.seVolume;
      this.seVolumeInput.value = String(this.seVolume);
      this.seVolumeLabel.textContent = `${Math.round(this.seVolume * 100)}%`;
      if (this.seGainNode) this.seGainNode.gain.value = this.seVolume;
    }
    if (settings.timingOffsetMs !== undefined) {
      this.timingOffset.value = String(settings.timingOffsetMs);
      this.audioManager?.setTimingOffset(ANSWER_SOUND_BASE_OFFSET_MS + settings.timingOffsetMs);
    }
    this.renderCurrentFrame();
  }

  private updateDiffSelect(chart: Chart | null, singleLabel?: string) {
    this.diffSelect.innerHTML = "";
    if (singleLabel) {
      const option = document.createElement("option");
      option.value = String(this.selectedDifficulty);
      option.textContent = singleLabel;
      this.diffSelect.appendChild(option);
      return;
    }
    for (const d of this.availableDifficulties) {
      const opt = document.createElement("option");
      opt.value = d.toString();
      const name = d >= 1 && d <= 6 ? DIFFICULTY_NAMES[d as ChartDifficulty] : `谱面 ${d}`;
      const level = chart?.level[`lv_${d}` as keyof Chart["level"]];
      opt.textContent = level ? `${name} · ${level}` : name;
      if (d === this.selectedDifficulty) opt.selected = true;
      this.diffSelect.appendChild(opt);
    }
  }

  private loadChart(chart: Chart) {
    this.chart = chart;
    this.timingTimeline = TimingTimeline.fromChart(chart);
    this.preparedAudioEvents = prepareAudioEvents(chart.notes);

    this.titleEl.textContent = chart.title || "Untitled";
    this.metaEl.textContent = `BPM ${chart.bpm} | Designer: ${chart.designer || "Unknown"}`;

    this.maxBeats = (chart.measures ?? 100) * 4;
    this.timelineSlider.max = this.maxBeats.toString();
    this.timelineSlider.value = this.currentBeats.toString();

    this.renderCurrentFrame();
  }

  private loadBgm(bgmUri: string) {
    if (!this.bgmAudio) {
      this.bgmAudio = new Audio();
    }
    this.bgmAudio.volume = this.musicVolume;
    this.bgmAudio.src = bgmUri;
    this.bgmAudio.load();
  }

  private seekTo(beat: number, autoPlay: boolean = false) {
    this.currentBeats = Math.max(0, Math.min(this.maxBeats, beat));
    this.timelineSlider.value = this.currentBeats.toString();

    if (this.timingTimeline && this.audioManager) {
      const ms = this.timingTimeline.msFromBeat(this.currentBeats);
      this.audioManager.reset(ms, true);

      if (this.bgmAudio && this.bgmAudio.duration) {
        const leadInMs = (60000 * 4) / (this.chart?.bpm || 120);
        const audioSec = Math.max(0, (ms - leadInMs) / 1000);
        if (audioSec < this.bgmAudio.duration) {
          this.bgmAudio.currentTime = audioSec;
        }
      }
    }

    this.renderCurrentFrame();

    if (autoPlay && !this.isPlaying) {
      this.startPlay();
    }
  }

  private async togglePlay() {
    if (this.isPlaying) {
      this.pause();
    } else {
      await this.startPlay();
    }
  }

  private async startPlay() {
    if (!this.chart) return;
    await this.ensureAudioContext();
    this.isPlaying = true;
    vscode.postMessage({ type: "playbackState", isPlaying: true, documentUri: this.documentUri, difficulty: this.selectedDifficulty });
    this.playIcon.className = "codicon codicon-debug-pause";
    this.playBtn.classList.add("active");
    this.playBtn.title = "暂停 (Space)";
    this.playBtn.setAttribute("aria-label", "暂停");
    this.lastAnimTime = performance.now();

    if (this.renderer) {
      this.renderer.setIsPlaying(true);
    }

    if (this.bgmAudio) {
      this.bgmAudio.playbackRate = this.playbackSpeed;
      this.bgmAudio.play().catch(() => {});
    }

    this.tick(performance.now());
  }

  private pause() {
    this.isPlaying = false;
    vscode.postMessage({ type: "playbackState", isPlaying: false, documentUri: this.documentUri, difficulty: this.selectedDifficulty });
    this.playIcon.className = "codicon codicon-play";
    this.playBtn.classList.remove("active");
    this.playBtn.title = "播放 (Space)";
    this.playBtn.setAttribute("aria-label", "播放");

    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    if (this.renderer) {
      this.renderer.setIsPlaying(false);
    }

    if (this.bgmAudio) {
      this.bgmAudio.pause();
    }

    if (this.timingTimeline && this.audioManager) {
      const currentMs = this.timingTimeline.msFromBeat(this.currentBeats);
      this.audioManager.reset(currentMs, true);
    }
  }

  private tick = (timestamp: number) => {
    if (!this.isPlaying) return;

    const deltaSec = (timestamp - this.lastAnimTime) / 1000;
    this.lastAnimTime = timestamp;

    if (this.chart && this.timingTimeline) {
      const currentBpm = this.timingTimeline.bpmAtBeat(this.currentBeats);
      const beatsPerSec = (currentBpm / 60) * this.playbackSpeed;
      this.currentBeats += deltaSec * beatsPerSec;

      if (this.currentBeats >= this.maxBeats) {
        this.pause();
        this.currentBeats = this.maxBeats;
      }

      const currentMs = this.timingTimeline.msFromBeat(this.currentBeats);

      if (this.audioManager) {
        this.audioManager.schedule(this.preparedAudioEvents, currentMs, this.playbackSpeed);
      }

      this.timelineSlider.value = this.currentBeats.toString();
      this.renderCurrentFrame();

      vscode.postMessage({ type: "cursorSync", currentBeat: this.currentBeats, documentUri: this.documentUri, difficulty: this.selectedDifficulty });
    }

    this.animFrameId = requestAnimationFrame(this.tick);
  };

  private renderCurrentFrame() {
    if (!this.renderer) return;

    if (!this.chart || !this.timingTimeline) {
      this.renderer.clear();
      this.renderer.renderJudgmentLine();
      return;
    }

    this.timeDisplay.textContent = `${this.formatTime(this.currentBeats)} / ${this.formatTime(this.maxBeats)}`;
    this.timelineSlider.setAttribute("aria-valuetext", this.timeDisplay.textContent);

    this.renderer.renderFrame(this.chart, this.currentBeats, 4);
  }

  private showError(msg: string) {
    this.errorBanner.textContent = `解析错误: ${msg}`;
    this.errorBanner.style.display = "block";
  }

  private hideError() {
    this.errorBanner.style.display = "none";
  }
}

window.addEventListener("DOMContentLoaded", () => {
  new MaimaiWebviewApp();
});
