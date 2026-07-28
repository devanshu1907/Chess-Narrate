// src/utils/geminiTts.ts

function addWavHeader(pcmBytes: Uint8Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + pcmBytes.byteLength);
  const view = new DataView(buffer);
  
  // Write "RIFF" chunk descriptor
  writeString(view, 0, 'RIFF');
  // Write chunk size: 36 + data size
  view.setUint32(4, 36 + pcmBytes.byteLength, true);
  // Write format: "WAVE"
  writeString(view, 8, 'WAVE');
  
  // Write "fmt " sub-chunk
  writeString(view, 12, 'fmt ');
  // Write sub-chunk size (16 for PCM)
  view.setUint32(16, 16, true);
  // Write audio format (1 for uncompressed PCM)
  view.setUint16(20, 1, true);
  // Write number of channels (1 for Mono)
  view.setUint16(22, 1, true);
  // Write sample rate
  view.setUint32(24, sampleRate, true);
  // Write byte rate: sampleRate * channels * bytesPerSample = sampleRate * 1 * 2 = sampleRate * 2
  view.setUint32(28, sampleRate * 2, true);
  // Write block align: channels * bytesPerSample = 1 * 2 = 2
  view.setUint16(32, 2, true);
  // Write bits per sample: 16
  view.setUint16(34, 16, true);
  
  // Write "data" sub-chunk
  writeString(view, 36, 'data');
  // Write data sub-chunk size
  view.setUint32(40, pcmBytes.byteLength, true);
  
  // Copy PCM bytes into the buffer after the 44-byte header
  const outArray = new Uint8Array(buffer, 44);
  outArray.set(pcmBytes);
  
  return buffer;
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

let activeAudio: HTMLAudioElement | null = null;

/**
 * Stops any ongoing Gemini TTS audio playback.
 */
export function stopGeminiAudio() {
  if (activeAudio) {
    try {
      activeAudio.pause();
      activeAudio.currentTime = 0;
    } catch (e) {
      console.error("Error stopping active audio:", e);
    }
    activeAudio = null;
  }
}

/**
 * Synthesizes text to speech using Google Gemini 3.1 Flash TTS API
 * and plays it in the browser.
 */
export function speakTextWithGemini(
  text: string,
  personality: 'sarcastic' | 'supportive' | 'grandmaster' | 'pirate',
  apiKey: string
): Promise<void> {
  return new Promise(async (resolve, reject) => {
    try {
      stopGeminiAudio();
      
      const cleanText = text
        .replace(/\[.*?\]/g, '') // strip brackets
        .replace(/Challenge!/g, '') // strip challenge exclamation
        .replace(/\b\d+\.\s*(\.+\s*)?/g, '') // strip move numbers like "1." or "12. ..."
        .replace(/[+#]/g, '') // strip check (+) and checkmate (#) symbols
        .trim();
      
      if (!cleanText) {
        resolve();
        return;
      }
      
      // Map chess personalities to Gemini prebuilt voices
      const voiceMap = {
        pirate: 'Fenrir',
        sarcastic: 'Puck',
        grandmaster: 'Kore',
        supportive: 'Aoede',
      };
      const voiceName = voiceMap[personality] || 'Puck';
      
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [{ text: cleanText }]
              }
            ],
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: voiceName
                  }
                }
              }
            }
          })
        }
      );
      
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error?.message || `Gemini TTS request failed with status ${res.status}`);
      }
      
      const data = await res.json();
      const base64Data = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Data) {
        throw new Error('No audio data returned from Gemini TTS');
      }
      
      // Decode Base64 string to raw binary bytes
      const binaryString = atob(base64Data);
      const len = binaryString.length;
      const pcmBytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        pcmBytes[i] = binaryString.charCodeAt(i);
      }
      
      // Compile raw PCM bytes into a playable WAV file (24kHz Mono 16-bit)
      const wavBuffer = addWavHeader(pcmBytes, 24000);
      const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });
      const wavUrl = URL.createObjectURL(wavBlob);
      
      const audio = new Audio(wavUrl);
      activeAudio = audio;
      
      audio.onended = () => {
        if (activeAudio === audio) {
          activeAudio = null;
        }
        URL.revokeObjectURL(wavUrl);
        resolve();
      };
      
      audio.onerror = (e) => {
        if (activeAudio === audio) {
          activeAudio = null;
        }
        URL.revokeObjectURL(wavUrl);
        reject(new Error("Audio playback failed or was aborted"));
      };
      
      audio.play().catch((err) => {
        // Can fail if browser autoplay policy blocks audio
        if (activeAudio === audio) {
          activeAudio = null;
        }
        URL.revokeObjectURL(wavUrl);
        reject(err);
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Searches the browser's local SpeechSynthesis voices and returns the best match
 * for the selected commentator personality.
 */
export function getBestLocalVoice(
  voices: SpeechSynthesisVoice[],
  personality: 'sarcastic' | 'supportive' | 'grandmaster' | 'pirate'
): SpeechSynthesisVoice | null {
  // Prioritized keyword list for each personality to match best-quality local voices
  const priorityMap = {
    pirate: [
      'google uk english male', 
      'microsoft ryan Online', 
      'daniel', 
      'david', 
      'male', 
      'uk', 
      'gb', 
      'en-gb', 
      'en-'
    ],
    grandmaster: [
      'google uk english male', 
      'microsoft george Online', 
      'hazel', 
      'daniel', 
      'uk', 
      'gb', 
      'en-gb', 
      'en-'
    ],
    supportive: [
      'google us english', 
      'microsoft aria Online', 
      'samantha', 
      'zira', 
      'female', 
      'en-us', 
      'en-'
    ],
    sarcastic: [
      'google us english', 
      'microsoft guy Online', 
      'samantha', 
      'puck', 
      'en-us', 
      'en-'
    ]
  };

  const priorities = priorityMap[personality] || priorityMap.sarcastic;
  const englishVoices = voices.filter(v => v.lang.startsWith('en'));
  if (englishVoices.length === 0) return null;

  for (const keyword of priorities) {
    const match = englishVoices.find(v => 
      v.name.toLowerCase().includes(keyword.toLowerCase()) || 
      v.lang.toLowerCase().includes(keyword.toLowerCase())
    );
    if (match) return match;
  }

  return englishVoices[0];
}
