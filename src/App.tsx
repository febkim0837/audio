import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, 
  Scissors, 
  FileText, 
  Download, 
  Play, 
  Pause, 
  Trash2, 
  Settings2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Music
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/src/lib/utils';
import { removeSilence, bufferToWav } from '@/src/lib/audioProcessor';
import { processScriptWithAudio, transcribeAudio, SubtitleChunk } from '@/src/lib/gemini';

// --- Components ---

const Card = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn("bg-[#151619] border border-[#2A2B2F] rounded-xl overflow-hidden shadow-2xl", className)}>
    {children}
  </div>
);

const Button = ({ 
  children, 
  onClick, 
  disabled, 
  variant = 'primary', 
  className,
  icon: Icon
}: { 
  children?: React.ReactNode; 
  onClick?: () => void; 
  disabled?: boolean; 
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  className?: string;
  icon?: any;
}) => {
  const variants = {
    primary: "bg-[#FF4444] hover:bg-[#FF6666] text-white",
    secondary: "bg-[#2A2B2F] hover:bg-[#3A3B3F] text-white border border-[#3A3B3F]",
    danger: "bg-transparent hover:bg-red-500/10 text-red-500 border border-red-500/20",
    ghost: "bg-transparent hover:bg-white/5 text-gray-400 hover:text-white"
  };

  return (
    <button 
      onClick={onClick} 
      disabled={disabled}
      className={cn(
        "flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none",
        variants[variant],
        className
      )}
    >
      {Icon && <Icon size={18} />}
      {children}
    </button>
  );
};

// --- Main App ---

export default function App() {
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [originalBuffer, setOriginalBuffer] = useState<AudioBuffer | null>(null);
  const [processedBuffer, setProcessedBuffer] = useState<AudioBuffer | null>(null);
  const [subtitles, setSubtitles] = useState<SubtitleChunk[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [threshold, setThreshold] = useState(0.01);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [activeSubtitleIndex, setActiveSubtitleIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const startTimeRef = useRef(0);
  const pauseTimeRef = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number | null>(null);

  // Initialize Audio Context
  useEffect(() => {
    audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    return () => {
      audioCtxRef.current?.close();
    };
  }, []);

  // Handle Audio File Upload
  const handleAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAudioFile(file);
    setError(null);
    
    try {
      const arrayBuffer = await file.arrayBuffer();
      const decodedBuffer = await audioCtxRef.current!.decodeAudioData(arrayBuffer);
      setOriginalBuffer(decodedBuffer);
      setProcessedBuffer(null);
      setSubtitles([]);
    } catch (err) {
      setError("오디오 파일을 불러오는 데 실패했습니다.");
      console.error(err);
    }
  };

  // Process Audio and Script
  const handleProcess = async () => {
    if (!originalBuffer || !audioFile) return;
    setIsProcessing(true);
    setError(null);

    try {
      // 1. Remove Silence
      const { processedBuffer: newBuffer } = await removeSilence(originalBuffer, threshold);
      setProcessedBuffer(newBuffer);

      // 2. Generate Subtitles (Auto-transcribe using Gemini)
      const wavBlob = bufferToWav(newBuffer);
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
      });
      reader.readAsDataURL(wavBlob);
      const base64Audio = await base64Promise;
      
      const chunks = await transcribeAudio(base64Audio, "audio/wav");
      setSubtitles(chunks);
    } catch (err) {
      setError("처리 중 오류가 발생했습니다.");
      console.error(err);
    } finally {
      setIsProcessing(false);
    }
  };

  // Playback Logic
  const togglePlay = () => {
    if (!processedBuffer && !originalBuffer) return;
    const buffer = processedBuffer || originalBuffer;

    if (isPlaying) {
      sourceNodeRef.current?.stop();
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      pauseTimeRef.current = audioCtxRef.current!.currentTime - startTimeRef.current;
      setIsPlaying(false);
    } else {
      const source = audioCtxRef.current!.createBufferSource();
      source.buffer = buffer;
      source.connect(audioCtxRef.current!.destination);
      
      const offset = pauseTimeRef.current % buffer!.duration;
      source.start(0, offset);
      startTimeRef.current = audioCtxRef.current!.currentTime - offset;
      sourceNodeRef.current = source;
      setIsPlaying(true);

      const updateProgress = () => {
        const now = audioCtxRef.current!.currentTime;
        const elapsed = now - startTimeRef.current;
        setCurrentTime(elapsed);
        
        // Find active subtitle
        const index = subtitles.findIndex(s => 
          elapsed >= s.start_time && 
          elapsed <= s.end_time
        );
        setActiveSubtitleIndex(index !== -1 ? index : null);

        if (elapsed < buffer!.duration) {
          requestRef.current = requestAnimationFrame(updateProgress);
        } else {
          setIsPlaying(false);
          pauseTimeRef.current = 0;
          setCurrentTime(0);
          setActiveSubtitleIndex(null);
        }
      };
      requestRef.current = requestAnimationFrame(updateProgress);

      source.onended = () => {
        // Handled by updateProgress for smoother UI
      };
    }
  };

  // Waveform Visualization
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const buffer = processedBuffer || originalBuffer;
    if (!buffer) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const data = buffer.getChannelData(0);
    const step = Math.ceil(data.length / canvas.width);
    const amp = canvas.height / 2;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw background waveform
    ctx.fillStyle = '#1A1B1E';
    for (let i = 0; i < canvas.width; i++) {
      let min = 1.0;
      let max = -1.0;
      for (let j = 0; j < step; j++) {
        const datum = data[i * step + j];
        if (datum < min) min = datum;
        if (datum > max) max = datum;
      }
      ctx.fillRect(i, (1 + min) * amp, 1, Math.max(1, (max - min) * amp));
    }

    // Draw progress
    const progressWidth = (currentTime / buffer.duration) * canvas.width;
    ctx.fillStyle = '#FF4444';
    for (let i = 0; i < progressWidth; i++) {
      let min = 1.0;
      let max = -1.0;
      for (let j = 0; j < step; j++) {
        const datum = data[i * step + j];
        if (datum < min) min = datum;
        if (datum > max) max = datum;
      }
      ctx.fillRect(i, (1 + min) * amp, 1, Math.max(1, (max - min) * amp));
    }

    // Draw playhead
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(progressWidth, 0);
    ctx.lineTo(progressWidth, canvas.height);
    ctx.stroke();

  }, [originalBuffer, processedBuffer, currentTime]);

  // Download Processed Audio
  const downloadAudio = () => {
    if (!processedBuffer) return;
    const blob = bufferToWav(processedBuffer);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `processed_${audioFile?.name || 'audio.wav'}`;
    a.click();
  };

  // Generate SRT
  const downloadSRT = () => {
    if (!subtitles.length || !processedBuffer) return;
    
    let srtContent = '';

    subtitles.forEach((sub, i) => {
      const start = formatSRTTime(sub.start_time);
      const end = formatSRTTime(sub.end_time);
      
      srtContent += `${i + 1}\n${start} --> ${end}\n${sub.text}\n\n`;
    });

    const blob = new Blob([srtContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'subtitles.srt';
    a.click();
  };

  const formatSRTTime = (seconds: number) => {
    const date = new Date(0);
    date.setSeconds(seconds);
    const ms = Math.floor((seconds % 1) * 1000);
    return date.toISOString().substr(11, 8) + ',' + ms.toString().padStart(3, '0');
  };

  return (
    <div className="min-h-screen bg-[#0A0B0D] text-white p-4 md:p-8 font-sans selection:bg-[#FF4444]/30">
      <div className="max-w-5xl mx-auto space-y-8">
        
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-[#2A2B2F] pb-6">
          <div>
            <div className="flex items-center gap-2 text-[#FF4444] mb-1">
              <Scissors size={20} />
              <span className="text-[10px] font-mono tracking-widest uppercase font-bold">ShortForm Pro</span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Audio & Subtitle</h1>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="text-right hidden md:block">
              <div className="text-[9px] text-gray-500 uppercase font-mono tracking-tighter">Status</div>
              <div className="text-[10px] text-green-500 font-mono">● READY</div>
            </div>
          </div>
        </header>

        <main className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Main Column */}
          <div className="lg:col-span-8 space-y-4">
            
            {/* Audio Upload & Preview */}
            <Card className="p-5">
              {!audioFile ? (
                <label className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed border-[#2A2B2F] rounded-xl cursor-pointer hover:border-[#FF4444]/50 hover:bg-[#FF4444]/5 transition-all group">
                  <div className="flex flex-col items-center justify-center">
                    <Upload className="w-8 h-8 mb-2 text-gray-500 group-hover:text-[#FF4444] transition-colors" />
                    <p className="text-sm text-gray-400 font-medium">오디오 파일 업로드</p>
                    <p className="text-[10px] text-gray-500 mt-1">WAV, MP3, M4A</p>
                  </div>
                  <input type="file" className="hidden" accept="audio/*" onChange={handleAudioUpload} />
                </label>
              ) : (
                <div className="space-y-4">
                  {/* Compact Subtitle Preview */}
                  <div className="relative h-24 bg-black rounded-xl overflow-hidden border border-[#2A2B2F] flex items-center justify-center">
                    <div className="absolute inset-0 opacity-10 pointer-events-none bg-[radial-gradient(circle_at_center,_#FF4444_0%,_transparent_70%)]" />
                    
                    <AnimatePresence mode="wait">
                      {activeSubtitleIndex !== null && subtitles[activeSubtitleIndex] ? (
                        <motion.div
                          key={activeSubtitleIndex}
                          initial={{ opacity: 0, y: 5 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -5 }}
                          className="z-10 px-4 text-center"
                        >
                          <p className="text-lg md:text-xl font-bold text-white drop-shadow-md">
                            {subtitles[activeSubtitleIndex].text}
                          </p>
                        </motion.div>
                      ) : (
                        <div className="text-gray-700 text-[10px] font-mono uppercase tracking-[0.2em]">
                          {isPlaying ? "Listening..." : "Waiting..."}
                        </div>
                      )}
                    </AnimatePresence>

                    <div className="absolute bottom-2 left-3 font-mono text-[9px] text-gray-500">
                      {formatSRTTime(currentTime).split(',')[0]}
                    </div>
                  </div>

                  {/* Waveform */}
                  <div className="relative h-20 bg-[#0A0B0D] rounded-lg overflow-hidden border border-[#2A2B2F]">
                    <canvas ref={canvasRef} className="w-full h-full" width={800} height={80} />
                    {processedBuffer && (
                      <div className="absolute top-2 right-2 bg-[#FF4444] text-[8px] px-1.5 py-0.5 rounded font-bold tracking-tighter uppercase">
                        Cleaned
                      </div>
                    )}
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Button onClick={togglePlay} variant="secondary" className="h-9 px-4" icon={isPlaying ? Pause : Play}>
                        {isPlaying ? "정지" : "재생"}
                      </Button>
                      <Button onClick={() => { setAudioFile(null); setOriginalBuffer(null); setProcessedBuffer(null); setCurrentTime(0); setActiveSubtitleIndex(null); }} variant="ghost" className="h-9 w-9 p-0" icon={Trash2} />
                    </div>

                    <div className="flex items-center gap-2">
                      {processedBuffer && (
                        <Button onClick={downloadAudio} variant="ghost" className="h-9 text-xs text-green-500 hover:text-green-400" icon={Download}>
                          오디오
                        </Button>
                      )}
                      {subtitles.length > 0 && (
                        <Button onClick={downloadSRT} variant="ghost" className="h-9 text-xs text-blue-500 hover:text-blue-400" icon={Download}>
                          자막
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </Card>

            {/* Subtitle List */}
            <Card className="p-5">
              <h2 className="text-sm font-bold uppercase tracking-widest text-gray-500 mb-4 flex items-center gap-2">
                <CheckCircle2 size={14} className="text-[#FF4444]" />
                생성된 자막 리스트
              </h2>
              
              <div className="h-64 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                {subtitles.length > 0 ? (
                  subtitles.map((sub, i) => (
                    <div 
                      key={i}
                      className={cn(
                        "p-3 border rounded-lg text-sm transition-all duration-300",
                        activeSubtitleIndex === i 
                          ? "border-[#FF4444] bg-[#FF4444]/10 text-white font-medium" 
                          : "border-[#2A2B2F] bg-[#0A0B0D] text-gray-400"
                      )}
                    >
                      <div className="flex justify-between items-center mb-1 text-[9px] font-mono uppercase opacity-50">
                        <span>{String(i+1).padStart(2, '0')}</span>
                        <span>{formatSRTTime(sub.start_time).split(',')[0]}</span>
                      </div>
                      {sub.text}
                    </div>
                  ))
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-gray-700 text-xs italic py-12">
                    <FileText size={24} className="mb-2 opacity-10" />
                    파일 처리 후 자막이 생성됩니다.
                  </div>
                )}
              </div>
            </Card>
          </div>

          {/* Right Column: Settings */}
          <div className="lg:col-span-4 space-y-4">
            <Card className="p-5">
              <h2 className="text-sm font-bold uppercase tracking-widest text-gray-500 mb-6 flex items-center gap-2">
                <Settings2 size={14} className="text-[#FF4444]" />
                설정 및 실행
              </h2>
              
              <div className="space-y-6">
                <div className="space-y-3">
                  <div className="flex justify-between text-[10px] font-mono">
                    <span className="text-gray-500">무음 제거 감도</span>
                    <span className="text-[#FF4444]">{Math.round(threshold * 1000) / 10}%</span>
                  </div>
                  <input 
                    type="range" 
                    min="0.001" 
                    max="0.1" 
                    step="0.001" 
                    value={threshold}
                    onChange={(e) => setThreshold(parseFloat(e.target.value))}
                    className="w-full h-1 bg-[#2A2B2F] rounded-lg appearance-none cursor-pointer accent-[#FF4444]"
                  />
                  <p className="text-[9px] text-gray-600 leading-relaxed">
                    * 무음 제거: 숨소리나 빈 공간을 자동으로 삭제하여 영상을 더 컴팩트하게 만듭니다. 감도가 높을수록 더 공격적으로 삭제합니다.
                  </p>
                </div>

                <Button 
                  onClick={handleProcess} 
                  disabled={!originalBuffer || isProcessing} 
                  className="w-full py-4 text-base font-bold"
                  icon={isProcessing ? Loader2 : Scissors}
                >
                  {isProcessing ? "처리 중..." : "자동 편집 시작"}
                </Button>

                {error && (
                  <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-500 text-[10px]">
                    <AlertCircle size={12} className="mt-0.5 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}
              </div>
            </Card>

            <div className="p-4 border border-[#2A2B2F] rounded-xl bg-[#151619]/50 text-[9px] text-gray-600 leading-relaxed">
              <p className="font-bold text-gray-500 mb-1 uppercase tracking-tighter">Quick Guide</p>
              1. 오디오 파일을 올립니다.<br/>
              2. '자동 편집 시작'을 누릅니다.<br/>
              3. AI가 무음을 지우고 자막을 만듭니다.<br/>
              4. 미리보기 확인 후 다운로드하세요.
            </div>
          </div>
        </main>

        {/* Footer Info */}
        <footer className="pt-12 border-t border-[#2A2B2F] flex flex-col md:flex-row justify-between gap-4 text-[10px] text-gray-600 font-mono uppercase tracking-widest">
          <div>© 2026 SHORTFORM_PRO // V1.1.0</div>
          <div className="flex gap-4">
            <span>Engine: Gemini-3-Flash</span>
            <span>Status: Online</span>
          </div>
        </footer>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #0A0B0D;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #2A2B2F;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #FF4444;
        }
      `}</style>
    </div>
  );
}
