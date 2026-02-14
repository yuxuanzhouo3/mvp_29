
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
            const data = await res.json();

            if (!res.ok) {
                console.error("ASR Signature Error:", data);
                throw new Error("Failed to get ASR signature");
            }

            // 2. Construct WebSocket URL
            // If backend provides pre-signed wsUrl, use it directly (Recommended)
            let wsUrl = data.url;

            if (!wsUrl && data.wsUrl) {
                wsUrl = data.wsUrl;
            }

            console.log("Connecting to ASR URL:", wsUrl);
            // DEBUG: 打印后端返回的签名原串，方便与文档对比
            if (data.signStr) {
                console.log("[DEBUG] Server Sign String:", data.signStr);
            }
            if (data.debugCurl) {
                console.log("[DEBUG] Test Curl Command (Copy and run in terminal to verify):");
                console.log(data.debugCurl);
            }

            // 3. Initialize WebSocket
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
                } catch (err) {
                    console.error("Failed to parse ASR message", err);
                }
            };

            // Initialize audio processing
            this.initAudioProcessing();
        } catch (err) {
            console.error("Failed to start ASR", err);
            this.callbacks.OnError?.(err);
            this.isRunning = false;
        }
    }

    private initAudioProcessing() {
        if (!this.audioTrack) return;

        try {
            this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            this.mediaStreamSource = this.audioContext.createMediaStreamSource(new MediaStream([this.audioTrack]));
            
            // Create a ScriptProcessorNode with a bufferSize of 4096 and a single input and output channel
            this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
            
            this.processor.onaudioprocess = (event) => {
                if (!this.isRunning || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
                
                const inputData = event.inputBuffer.getChannelData(0);
                
                // Convert float32 audio to int16
                const dataLength = inputData.length;
                const intData = new Int16Array(dataLength);
                
                for (let i = 0; i < dataLength; i++) {
                    const s = Math.max(-1, Math.min(1, inputData[i]));
                    intData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                }
                
                // Send raw PCM data
                this.ws.send(intData.buffer);
            };
            
            this.mediaStreamSource.connect(this.processor);
            this.processor.connect(this.audioContext.destination);
            
        } catch (e) {
            console.error("Failed to initialize audio processing", e);
            this.callbacks.OnError?.(e);
        }
    }

    private flushAudioBuffer() {
        // Implementation for flushing buffer if needed
    }

    stop() {
        this.isRunning = false;
        
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
        
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}
