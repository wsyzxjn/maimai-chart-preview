import type { Chart, ChartFileType } from "@lxns-network/maimai-chart-engine";

export interface WebviewAssetUris {
  sensorUrl: string;
  answerSoundUrl: string;
  tapSoundUrl: string;
  touchSoundUrl: string;
  breakSoundUrl: string;
  slideSoundUrl: string;
  cheerSoundUrl: string;
  exSoundUrl: string;
  fireworkSoundUrl: string;
  breakSlideSoundUrl: string;
  breakSlideCheerSoundUrl: string;
  touchHoldSoundUrl: string;
}

/**
 * 宿主 Extension Host -> Webview 发送的消息协议
 */
export type HostToWebviewMessage =
  | {
      type: "init";
      assets: WebviewAssetUris;
      settings: {
        hiSpeed: number;
        judgmentLineDesign: "sensor" | "simple" | "noLine" | "blind";
        showFireworks: boolean;
        enableHitsound: boolean;
        musicVolume: number;
        seVolume: number;
        timingOffsetMs: number;
      };
    }
  | {
      type: "chartUpdate";
      documentUri: string;
      format: ChartFileType;
      hasDifficultySections: boolean;
      chart: Chart | null;
      rawText: string;
      error?: string;
      availableDifficulties: number[];
      selectedDifficulty: number;
      bgmUri?: string;
      initialBeat?: number;
      autoPlay?: boolean;
    }
  | {
      type: "seekToBeat";
      beat: number;
      autoPlay?: boolean;
      onlyWhenPaused?: boolean;
    }
  | {
      type: "followPlaybackState";
      enabled: boolean;
    }
  | {
      type: "updateSettings";
      settings: Partial<{
        hiSpeed: number;
        judgmentLineDesign: "sensor" | "simple" | "noLine" | "blind";
        showFireworks: boolean;
        enableHitsound: boolean;
        musicVolume: number;
        seVolume: number;
        timingOffsetMs: number;
      }>;
    };

/**
 * Webview -> 宿主 Extension Host 发送的消息协议
 */
export type WebviewToHostMessage =
  | {
      type: "ready";
    }
  | {
      type: "selectDifficulty";
      difficulty: number;
    }
  | {
      type: "cursorSync";
      currentBeat: number;
      documentUri: string;
      difficulty: number;
    }
  | {
      type: "playbackState";
      isPlaying: boolean;
      documentUri: string;
      difficulty: number;
    }
  | {
      type: "setFollowPlayback";
      enabled: boolean;
    }
  | {
      type: "showError";
      message: string;
    };
