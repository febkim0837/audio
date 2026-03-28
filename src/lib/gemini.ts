import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface SubtitleChunk {
  text: string;
  start_time: number; // Start time in seconds
  end_time: number;   // End time in seconds
}

export async function transcribeAudio(audioBase64: string, mimeType: string): Promise<SubtitleChunk[]> {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        inlineData: {
          data: audioBase64,
          mimeType: mimeType
        }
      },
      {
        text: "Transcribe this audio and break it into short, punchy subtitle chunks suitable for short-form video. For each chunk, provide the exact 'start_time' and 'end_time' in seconds relative to the audio start. Return a JSON array of objects with 'text', 'start_time', and 'end_time'."
      }
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            text: { type: Type.STRING },
            start_time: { type: Type.NUMBER },
            end_time: { type: Type.NUMBER }
          },
          required: ["text", "start_time", "end_time"]
        }
      }
    }
  });

  try {
    return JSON.parse(response.text);
  } catch (e) {
    console.error("Failed to parse Gemini transcription response", e);
    return [];
  }
}

export async function processScriptWithAudio(script: string, audioBase64: string, mimeType: string): Promise<SubtitleChunk[]> {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        inlineData: {
          data: audioBase64,
          mimeType: mimeType
        }
      },
      {
        text: `Using the provided script, align it with the audio and break it into short subtitle chunks. 
        For each chunk, provide the exact 'start_time' and 'end_time' in seconds.
        
        Script:
        ${script}`
      }
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            text: { type: Type.STRING },
            start_time: { type: Type.NUMBER },
            end_time: { type: Type.NUMBER }
          },
          required: ["text", "start_time", "end_time"]
        }
      }
    }
  });

  try {
    return JSON.parse(response.text);
  } catch (e) {
    console.error("Failed to parse Gemini script alignment response", e);
    return [];
  }
}

export async function processScript(script: string): Promise<SubtitleChunk[]> {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Break the following script into short, punchy subtitle chunks suitable for short-form video (TikTok/Reels). 
    Each chunk should be a single phrase or short sentence. 
    Return a JSON array of objects with 'text' and 'duration_weight' (a number representing relative length/complexity of the text).
    
    Script:
    ${script}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            text: { type: Type.STRING },
            duration_weight: { type: Type.NUMBER }
          },
          required: ["text", "duration_weight"]
        }
      }
    }
  });

  try {
    return JSON.parse(response.text);
  } catch (e) {
    console.error("Failed to parse Gemini response", e);
    return [{ text: script, start_time: 0, end_time: 5 }];
  }
}
