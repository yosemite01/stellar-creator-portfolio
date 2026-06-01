// Device-dictation speech-to-text with media-overlay timestamp alignment and WebVTT export
export interface VTTCue {
  startTime: number;
  endTime: number;
  text: string;
}

export interface SubtitleSession {
  cues: VTTCue[];
  isActive: boolean;
}

function toVTTTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}

export function exportToWebVTT(cues: VTTCue[]): string {
  const body = cues
    .map((cue, i) => `${i + 1}\n${toVTTTime(cue.startTime)} --> ${toVTTTime(cue.endTime)}\n${cue.text}`)
    .join('\n\n');
  return `WEBVTT\n\n${body}`;
}

export function createSubtitleSession(): SubtitleSession {
  return { cues: [], isActive: false };
}

export function appendCue(
  session: SubtitleSession,
  text: string,
  startTime: number,
  endTime: number,
): SubtitleSession {
  return { ...session, cues: [...session.cues, { text, startTime, endTime }] };
}

export function startSession(session: SubtitleSession): SubtitleSession {
  return { ...session, isActive: true };
}

export function stopSession(session: SubtitleSession): SubtitleSession {
  return { ...session, isActive: false };
}
