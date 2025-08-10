// Simple speech synthesis queue
// Provides a lightweight API to enqueue lines of text
// and handles rate/voice settings internally.

export type RateGetter = () => number;
export type MutedGetter = () => boolean;

// Preload available voices to avoid the first call being ignored on some platforms
export function warmVoices(): void {
  // Fetch the voices list which triggers voice loading in Chrome based browsers
  try { window.speechSynthesis.getVoices(); } catch {}
}

export function createSpeechQueue(getRate: RateGetter, isMuted: MutedGetter) {
  let speaking = false;
  const q: string[] = [];

  function pump() {
    if (speaking || q.length === 0) return;
    speaking = true;
    const text = q.shift()!;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = getRate();
    u.onstart = () => console.log('[TTS] start:', text);
    u.onerror = (e) => { console.warn('[TTS] error:', e); speaking = false; pump(); };
    u.onend = () => { console.log('[TTS] end'); speaking = false; pump(); };
    try { window.speechSynthesis.speak(u); }
    catch (e) { console.warn('[TTS] speak threw', e); speaking = false; }
  }

  function enqueue(text: string): void {
    if (isMuted()) return;
    q.push(text);
    pump();
  }

  return { enqueue };
}

