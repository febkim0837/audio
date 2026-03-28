/**
 * Audio processing utilities for silence removal and analysis.
 */

export interface SilenceSegment {
  start: number;
  end: number;
}

export async function removeSilence(
  audioBuffer: AudioBuffer,
  threshold: number = 0.01,
  minSilenceDuration: number = 0.1
): Promise<{ processedBuffer: AudioBuffer; segments: SilenceSegment[] }> {
  const channelData = audioBuffer.getChannelData(0); // Use first channel for analysis
  const sampleRate = audioBuffer.sampleRate;
  const minSilenceSamples = minSilenceDuration * sampleRate;
  
  const nonSilentSegments: { start: number; end: number }[] = [];
  let isSilent = true;
  let segmentStart = 0;
  let silenceCounter = 0;

  // Simple energy-based silence detection
  for (let i = 0; i < channelData.length; i++) {
    const amplitude = Math.abs(channelData[i]);
    
    if (amplitude < threshold) {
      if (!isSilent) {
        silenceCounter++;
        if (silenceCounter >= minSilenceSamples) {
          nonSilentSegments.push({ start: segmentStart, end: i - silenceCounter });
          isSilent = true;
        }
      }
    } else {
      if (isSilent) {
        segmentStart = i;
        isSilent = false;
      }
      silenceCounter = 0;
    }
  }

  // Add the last segment if it wasn't silent
  if (!isSilent) {
    nonSilentSegments.push({ start: segmentStart, end: channelData.length });
  }

  // Calculate total length of non-silent parts
  const totalLength = nonSilentSegments.reduce((acc, seg) => acc + (seg.end - seg.start), 0);
  
  // Create new buffer
  const offlineCtx = new OfflineAudioContext(
    audioBuffer.numberOfChannels,
    totalLength,
    sampleRate
  );
  
  const processedBuffer = offlineCtx.createBuffer(
    audioBuffer.numberOfChannels,
    totalLength,
    sampleRate
  );

  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
    const originalData = audioBuffer.getChannelData(channel);
    const newData = processedBuffer.getChannelData(channel);
    let offset = 0;
    
    for (const seg of nonSilentSegments) {
      const segmentData = originalData.subarray(seg.start, seg.end);
      newData.set(segmentData, offset);
      offset += segmentData.length;
    }
  }

  // Convert sample indices to seconds for segments
  const segments = nonSilentSegments.map(seg => ({
    start: seg.start / sampleRate,
    end: seg.end / sampleRate
  }));

  return { processedBuffer, segments };
}

export function bufferToWav(buffer: AudioBuffer): Blob {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const bufferArray = new ArrayBuffer(length);
  const view = new DataView(bufferArray);
  const channels = [];
  let i;
  let sample;
  let offset = 0;
  let pos = 0;

  // write WAVE header
  setUint32(0x46464952);                         // "RIFF"
  setUint32(length - 8);                         // file length - 8
  setUint32(0x45564157);                         // "WAVE"

  setUint32(0x20746d66);                         // "fmt " chunk
  setUint32(16);                                 // length = 16
  setUint16(1);                                  // PCM (uncompressed)
  setUint16(numOfChan);
  setUint32(buffer.sampleRate);
  setUint32(buffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
  setUint16(numOfChan * 2);                      // block-align
  setUint16(16);                                 // 16-bit (hardcoded)

  setUint32(0x61746164);                         // "data" - chunk
  setUint32(length - pos - 4);                   // chunk length

  // write interleaved data
  for(i = 0; i < buffer.numberOfChannels; i++)
    channels.push(buffer.getChannelData(i));

  while(pos < length) {
    for(i = 0; i < numOfChan; i++) {             // interleave channels
      sample = Math.max(-1, Math.min(1, channels[i][offset])); // clamp
      sample = (sample < 0 ? sample * 0x8000 : sample * 0x7FFF); // scale to 16-bit signed int
      view.setInt16(pos, sample, true);          // write 16-bit sample
      pos += 2;
    }
    offset++;                                     // next sample
  }

  return new Blob([bufferArray], {type: "audio/wav"});

  function setUint16(data: number) {
    view.setUint16(pos, data, true);
    pos += 2;
  }

  function setUint32(data: number) {
    view.setUint32(pos, data, true);
    pos += 4;
  }
}
