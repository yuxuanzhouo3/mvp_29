
interface ASROptions {
    audioTrack?: MediaStreamTrack;
    // Callback functions
    OnRecognitionStart?: (res: any) => void;
    OnSentenceBegin?: (res: any) => void;
    OnRecognitionResultChange?: (res: any) => void;
    OnSentenceEnd?: (res: any) => void;
    OnRecognitionComplete?: (res: any) => void;
    OnError?: (error: any) => void;
}

export class TencentASR {
    private audioTrack?: MediaStreamTrack;
    private callbacks: Omit<ASROptions, 'audioTrack'>;
    private ws: WebSocket | null = null;
    private audioContext: AudioContext | null = null;
    private processor: ScriptProcessorNode | null = null;
    private mediaStreamSource: MediaStreamAudioSourceNode | null = null;
    private isRunning: boolean = false;
    private audioBuffer: Int16Array[] = [];
    private audioBufferLen: number = 0;
    private isConnecting: boolean = false;

    constructor(options: ASROptions) {
        this.audioTrack = options.audioTrack;
        this.callbacks = {
            OnRecognitionStart: options.OnRecognitionStart,
            OnSentenceBegin: options.OnSentenceBegin,
            OnRecognitionResultChange: options.OnRecognitionResultChange,
            OnSentenceEnd: options.OnSentenceEnd,
            OnRecognitionComplete: options.OnRecognitionComplete,
            OnError: options.OnError,
        };
    }

    async start() {
        if (this.isRunning) return;
        this.isRunning = true;

        try {
            // 1. Get Signature and Config from Backend
            const res = await fetch("/api/transcribe/stream?action=get_signature", { method: "POST" });
            if (!res.ok) {
                throw new Error("Failed to get ASR signature");
            }
            const config = await res.json();
            const { signature, secretid, timestamp, expired, nonce, engine_model_type, voice_id, voice_format, needvad, appid, vad_silence_time, punc, filter_dirty, filter_modal, filter_punc, convert_num_mode, word_info } = config;

            // 2. Construct WebSocket URL
            const wsUrl = `wss://asr.cloud.tencent.com/asr/v2/${appid}?` +
                `secretid=${secretid}&` +
                `timestamp=${timestamp}&` +
                `expired=${expired}&` +
                `nonce=${nonce}&` +
                `engine_model_type=${engine_model_type}&` +
                `voice_id=${voice_id}&` +
                `voice_format=${voice_format}&` +
                `needvad=${needvad}&` +
                `vad_silence_time=${vad_silence_time ?? 800}&` +
                `punc=${punc ?? 0}&` +
                `filter_dirty=${filter_dirty ?? 1}&` +
                `filter_modal=${filter_modal ?? 1}&` +
                `filter_punc=${filter_punc ?? 0}&` +
                `convert_num_mode=${convert_num_mode ?? 1}&` +
                `word_info=${word_info ?? 0}&` +
                `signature=${encodeURIComponent(signature)}`;

            // 3. Initialize WebSocket
            this.isConnecting = true;
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                console.log("Tencent ASR WebSocket connected");
                this.isConnecting = false;
                this.callbacks.OnRecognitionStart?.({ code: 0, message: "Connected" });
                this.flushAudioBuffer();
            };

            this.ws.onerror = (e) => {
                console.error("ASR WebSocket Error", e);
                this.callbacks.OnError?.(e);
            };

            this.ws.onclose = () => {
                console.log("ASR WebSocket Closed");
                if (this.isRunning) {
                    // Reconnect logic could go here, but for now just stop
                    this.stop();
                }
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data as string);
                    if (data.code !== 0) {
                        this.callbacks.OnError?.(data);
                        return;
                    }

                    if (data.result) {
                        // Map Tencent ASR response to callbacks
                        // result.voice_text_str is the current sentence text
                        // final=1 means sentence end

                        if (data.final === 1) {
                            this.callbacks.OnSentenceEnd?.({ result: data.result });
                        } else {
                            // Assuming slice type or just interim
                            this.callbacks.OnRecognitionResultChange?.({ result: data.result });
                        }
                    }
                } catch (e) {
                    console.error("Error parsing ASR message", e);
                }
            };

            // 4. Start Audio Processing if track is provided
            if (this.audioTrack) {
                await this.startAudioProcessing();
            }

        } catch (e) {
            console.error("Failed to start ASR", e);
            this.callbacks.OnError?.(e);
            this.stop();
        }
    }

    // Allow external feeding of audio data (e.g. from Android Native Bridge)
    public feedAudio(pcmData: Int16Array) {
        if (!this.isRunning) return;
        this.sendAudio(pcmData);
    }

    private async startAudioProcessing() {
        if (!this.audioTrack) return;
        const AudioContextCtor = (window.AudioContext || (window as any).webkitAudioContext);
        if (!AudioContextCtor) throw new Error("AudioContext not supported");

        this.audioContext = new AudioContextCtor({ sampleRate: 16000 });

        // Use the MediaStreamTrack directly
        const stream = new MediaStream([this.audioTrack]);

        this.mediaStreamSource = this.audioContext.createMediaStreamSource(stream);

        // Use ScriptProcessor for resampling and extraction
        // Buffer size 4096 is safer for performance, but 1024 is lower latency
        // Tencent ASR expects 16k PCM
        this.processor = this.audioContext.createScriptProcessor(1024, 1, 1);

        this.mediaStreamSource.connect(this.processor);
        this.processor.connect(this.audioContext.destination); // Required for Chrome to fire events

        this.processor.onaudioprocess = (event) => {
            if (!this.isRunning) return;

            const input = event.inputBuffer.getChannelData(0);

            // Resample if context is not 16k (though we requested 16k, some browsers ignore it)
            // But we created AudioContext with sampleRate: 16000, so it should be 16k.
            // Let's verify.
            let pcmData: Int16Array;

            if (event.inputBuffer.sampleRate === 16000) {
                pcmData = new Int16Array(input.length);
                for (let i = 0; i < input.length; i++) {
                    const s = Math.max(-1, Math.min(1, input[i]));
                    pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                }
            } else {
                // Resample to 16k
                const targetSampleRate = 16000;
                const sourceSampleRate = event.inputBuffer.sampleRate;
                const ratio = sourceSampleRate / targetSampleRate;
                const newLength = Math.round(input.length / ratio);
                pcmData = new Int16Array(newLength);

                for (let i = 0; i < newLength; i++) {
                    const srcIdx = Math.floor(i * ratio);
                    let val = input[srcIdx];
                    if (srcIdx + 1 < input.length) {
                        const frac = (i * ratio) - srcIdx;
                        val = val * (1 - frac) + input[srcIdx + 1] * frac;
                    }
                    const s = Math.max(-1, Math.min(1, val));
                    pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                }
            }

            this.sendAudio(pcmData);
        };
    }

    private sendAudio(pcmData: Int16Array) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            // Flush buffer if any
            this.flushAudioBuffer();
            this.ws.send(pcmData.buffer);
        } else if (this.isConnecting) {
            // Buffer
            this.audioBuffer.push(pcmData);
            this.audioBufferLen += pcmData.length;
            // Limit buffer to ~5s
            if (this.audioBufferLen > 16000 * 5) {
                const removeCount = this.audioBuffer[0].length;
                this.audioBuffer.shift();
                this.audioBufferLen -= removeCount;
            }
        }
    }

    private flushAudioBuffer() {
        if (this.audioBufferLen > 0 && this.ws && this.ws.readyState === WebSocket.OPEN) {
            const totalLen = this.audioBufferLen;
            const merged = new Int16Array(totalLen);
            let offset = 0;
            for (const chunk of this.audioBuffer) {
                merged.set(chunk, offset);
                offset += chunk.length;
            }
            // Send in chunks
            const CHUNK_SIZE = 12800; // 400ms
            const buffer = merged.buffer;
            let sentBytes = 0;
            while (sentBytes < buffer.byteLength) {
                const end = Math.min(sentBytes + CHUNK_SIZE, buffer.byteLength);
                const chunk = buffer.slice(sentBytes, end);
                this.ws.send(chunk);
                sentBytes = end;
            }
            this.audioBuffer = [];
            this.audioBufferLen = 0;
        }
    }

    stop() {
        this.isRunning = false;
        this.isConnecting = false;

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        if (this.processor) {
            this.processor.disconnect();
            this.processor = null;
        }

        if (this.mediaStreamSource) {
            this.mediaStreamSource.disconnect();
            this.mediaStreamSource = null;
        }

        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        this.audioBuffer = [];
        this.audioBufferLen = 0;
        this.callbacks.OnRecognitionComplete?.({});
    }
}
