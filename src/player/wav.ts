/** Float PCM in [-1, 1] to 16-bit signed samples. */
export function toInt16(pcm: Float32Array): Int16Array {
  const out = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/**
 * A 16-bit mono WAV file from already-converted parts, so long exports never
 * hold more than one copy of the audio as floats.
 */
export function wavFromInt16(parts: Int16Array[], sampleRate: number): Blob {
  const samples = parts.reduce((n, p) => n + p.length, 0);
  const header = new DataView(new ArrayBuffer(44));
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) header.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  header.setUint32(4, 36 + samples * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true); // PCM
  header.setUint16(22, 1, true); // mono
  header.setUint32(24, sampleRate, true);
  header.setUint32(28, sampleRate * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  ascii(36, 'data');
  header.setUint32(40, samples * 2, true);
  return new Blob([header.buffer, ...parts.map((p) => p.buffer as ArrayBuffer)], { type: 'audio/wav' });
}

export function encodeWav(pcm: Float32Array, sampleRate: number): Blob {
  return wavFromInt16([toInt16(pcm)], sampleRate);
}
