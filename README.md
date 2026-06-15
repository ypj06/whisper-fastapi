
# Vidsight · YouTube Knowledge Extraction
> Paste any YouTube link with subtitles → Gemini generates well-structured Chinese articles in real time. Each chapter supports one-click **5W1H** summary.

Fully deployed on **Cloudflare Workers**: zero cold start, global edge network. The frontend is a build-free single-page application (SPA) served via Workers Assets. Both frontend and backend are developed in TypeScript with clear module boundaries; every source file stays around 400 lines or fewer.

- Demo Video: <https://www.youtube.com/watch?v=xRh2sVcNXQ8>
- Demo URL: Refer to the deployment guide below for your `*.workers.dev` domain

## Features
- **Streaming Generation**: The backend uses Gemini's `streamGenerateContent` (SSE) to push content token by token. The frontend parses streams natively with `fetch + ReadableStream` and renders formatted Markdown via `markdown-it` incrementally, instead of displaying raw markup symbols.
- **Chapter-level 5W1H Summary**: Articles are split by `##` headings. The frontend only sends `{sessionId, chapterIndex}` to `/api/5w1h` without retransmitting full content. All context is stored in Cloudflare KV (7-day TTL).
- **Customizable Prompts**: Configure task type, writing style, target audience and constraints manually, or quickly apply three presets: Business Insight, Technical Deep Dive, Casual Explanation.
- **AI Gateway Integration (Optional)**: Simply set `CF_AIG_URL` to route all Gemini requests through Cloudflare AI Gateway. This bypasses regional access restrictions for Cloudflare Worker egress IPs and enables built-in caching, rate limiting, traffic metrics and observability.
- **Fallback Strategies for YouTube Subtitles**: Multi-path retrieval including embedded HTML parsing, Innertube `player` client strategies and Innertube `next → get_transcript`. It automatically adapts to multiple subtitle formats (XML, SRV3, VTT, JSON3, TTML) and supports proxy forwarding for higher success rates. If all attempts fail, the system falls back to built-in demo subtitles.
- **Build-free Frontend**: The entire SPA consists of three files under the `public` folder. Dependencies like `markdown-it` and DOMPurify are loaded via Import Map and esm.sh, requiring no bundlers or compilation.
- **Graceful Degradation**: When subtitle retrieval fails due to missing captions or IP restrictions, a prominent banner notifies users that demo content is in use, avoiding silent failures.

## Quick Start
```bash
git clone <this-repo>
cd youtube-knowledge-extractor

# 1. Install dependencies
npm install

# 2. Create local config (excluded from Git)
cp .dev.vars.example .dev.vars
# Edit .dev.vars and fill in your GEMINI_API_KEY

# 3. Run locally
npm run dev
# Visit http://127.0.0.1:8787
```

Only a valid `GEMINI_API_KEY` is required for local testing. Other configuration items are optional and mainly used to resolve network issues after deployment.

## Deploy to Cloudflare Workers
```bash
# 1. Log in to Cloudflare
npx wrangler login

# 2. Create KV Namespace for 5W1H session storage, paste the returned ID into wrangler.toml
npx wrangler kv namespace create SESSIONS
npx wrangler kv namespace create SESSIONS --preview
# Note: If a duplicate namespace error occurs, run `npx wrangler kv namespace list` to reuse existing IDs

# 3. Set secrets
npx wrangler secret put GEMINI_API_KEY    # Required

# 4. (Strongly Recommended) Configure AI Gateway to bypass regional restrictions
# Go to Cloudflare Dashboard → AI → AI Gateway → Create Gateway
npx wrangler secret put CF_AIG_URL
# Paste your gateway URL in this format:
# https://gateway.ai.cloudflare.com/v1/<your-account-id>/<gateway-name>/google-ai-studio

# 5. Deploy the project
npm run deploy

# 6. (Optional) View real-time logs
npx wrangler tail youtube-knowledge-extractor --format pretty
```

After deployment, you will get a public URL: `https://youtube-knowledge-extractor.<account>.workers.dev`.

### Use Local Override (Without Modifying wrangler.toml)
If you fork this repository for long-term personal use, keep the original `wrangler.toml` as a public template and store your real KV IDs in `wrangler.local.toml` (ignored by Git):
```bash
cp wrangler.local.toml.example wrangler.local.toml
# Replace placeholder KV IDs with real values inside wrangler.local.toml

npm run dev:my       # Equals: wrangler dev --config wrangler.local.toml
npm run deploy:my    # Equals: wrangler deploy --config wrangler.local.toml
```

Store secrets with the custom config as well:
`npx wrangler secret put GEMINI_API_KEY --config wrangler.local.toml`

This prevents conflicts when pulling upstream updates and avoids exposing sensitive IDs in public repositories.

## Configuration Reference
| Type | Key | Required | Description |
|------|-----|----------|-------------|
| Secret | `GEMINI_API_KEY` | ✅ | Google AI Studio API Key |
| Secret | `CF_AIG_URL` | ⛔ | Cloudflare AI Gateway base URL |
| Secret | `CF_AIG_TOKEN` | ⛔ | Bearer token for authenticated AI Gateway access |
| Secret | `WEBSHARE_PROXY` | ⛔ | Proxy address in `host:port:user:pass` format to bypass YouTube restrictions |
| Secret | `YT_COOKIE` | ⛔ | YouTube login cookie to mitigate bot detection on datacenter IPs |
| Variable | `GEMINI_MODEL` | ⛔ | Default: `gemini-2.5-flash`; supports other available models |
| Variable | `DEMO_FALLBACK` | ⛔ | Enable demo subtitles when retrieval fails (default: `true`) |
| Binding | `SESSIONS` (KV) | ✅ | KV namespace for chapter 5W1H session storage |
| Binding | `ASSETS` | ✅ | Auto-bound to the `./public` directory via wrangler.toml |

## Working Mechanism
### 1. Subtitle Retrieval (`src/services/transcript.ts`)
The system attempts multiple methods sequentially and returns content on the first successful attempt:
1. Parse `ytInitialPlayerResponse` from YouTube page HTML to extract `captionTracks`.
2. Call Innertube `/youtubei/v1/player` with multiple client configurations (Android client, Android with API key, Web client with desktop User-Agent) if HTML parsing fails.
3. Fetch timestamped transcripts via Innertube `next → get_transcript` when standard caption tracks are unavailable.
4. Select the optimal subtitle track (manual captions > auto-generated; Chinese > other languages) and request subtitle files. It automatically adapts to SRV3, VTT, JSON3 and TTML formats, and switches between direct connection and proxy to avoid YouTube rate limits.
5. Fall back to built-in demo subtitles if all retrieval attempts fail (controlled by `DEMO_FALLBACK`).

### 2. Forward Proxy via cloudflare:sockets (`src/services/proxyFetch.ts`)
Cloudflare Workers' native `fetch` does not support custom outbound proxies. This project implements a **forward proxy** using `cloudflare:sockets.connect()`:
```
Worker --TCP--> Webshare Proxy --TLS--> YouTube Server
Full HTTPS URL is sent in the request line for proxy forwarding
```
This approach avoids known issues of `socket.startTls()` on workerd. The implementation handles `Content-Length`, chunked encoding and connection closure rules, disables gzip compression, sets a 15-second global timeout, and automatically falls back to direct fetch when the proxy fails.

### 3. Gemini Streaming Generation (`src/services/gemini.ts`)
- Native `streamGenerateContent?alt=sse` is used without third-party LLM SDKs. SSE streams are parsed manually and exposed as async string iterators.
- `resolveEndpoint()` seamlessly switches between direct Google requests and Cloudflare AI Gateway. API keys are placed in request headers instead of query strings for gateway security.
- Thinking budget is disabled to avoid delayed first token output. All safety filters are set to `BLOCK_NONE` to prevent false interception of long subtitle content.

The main `/api/generate` endpoint returns SSE events in the following structure:

| Event | Content |
|-------|---------|
| meta | Session ID, video information, language and subtitle error details (if any) |
| token | Incremental text chunks from Gemini |
| done | Session ID, chapter list and total content length |
| error | Error message and type |

### 4. Chapter-based 5W1H Summary (`src/services/session.ts` + `/api/5w1h`)
- After article generation completes, the full content and user preferences are saved to Cloudflare KV with a 7-day retention period. The article is split into chapters by `##` headings.
- The frontend only stores the `sessionId` and chapter index. Clicking the 5W1H button sends minimal requests without retransmitting full articles.
- The backend reads cached context, generates dedicated prompts and requests structured JSON output from Gemini for 5W1H analysis.

### 5. Custom Generation Preferences (`GenerationPreferences` + `buildArticlePrompt`)
Four configurable fields (Task Type, Writing Style, Target Audience, Constraints) are injected into prompts to adjust content orientation, tone and terminology. These soft constraints work alongside fixed output rules (Markdown structure, chapter count, word count range):
- **Task Type**: Defines the analysis perspective (e.g. business insight, technical review).
- **Style**: Adjusts writing tone (professional, technical, casual).
- **Audience**: Controls terminology difficulty and explanation depth.
- **Constraints**: Adds extra rules such as retaining key figures or avoiding jargon.

Three one-click presets are provided for quick configuration. All preferences are reused for both full articles and chapter-level 5W1H summaries to maintain consistent analysis logic.

## Technical Decisions & Highlights
| Decision | Implementation | Reason |
|----------|----------------|--------|
| Frontend Build | Build-free SPA (HTML + Import Map + esm.sh) | Instant preview after edits; lightweight static deployment via Workers Assets |
| LLM Invocation | Native fetch + custom SSE parser | Small bundle size, full stream control, unified logic for direct and gateway requests |
| Streaming Rendering | Full Markdown re-render per token | Users see formatted content in real time instead of raw markup |
| 5W1H Context | KV session storage | Reduces bandwidth consumption and prevents content tampering |
| Subtitle Retrieval | Multi-path fallback + proxy support | Mitigates YouTube IP bans and rate limits on datacenter IPs |
| Proxy Implementation | cloudflare:sockets forward proxy | Bypasses Workers fetch proxy limitations and workerd TLS bugs |
| Failure Handling | Demo subtitles + user notification | Ensures demo availability and transparent error feedback |
| Code Structure | Modular TypeScript, file size control | High readability and maintainability for secondary development |
| Deployment | Workers + KV + Assets | Global edge network, zero cold start, no traditional server required |

### Core Advantages
1. **End-to-end TypeScript**: Unified type definitions across frontend, backend and prompt logic.
2. **Dual-layer Prompt Design**: Separates fixed output rules and customizable user requirements.
3. **Comprehensive Observability**: Dedicated endpoints for configuration checks and upstream debugging.
4. **Production-grade UX**: Streaming cursor, one-click summary buttons, copy functions and back-to-top controls.

## Known Limitations
- **YouTube IP Restrictions**: Cloudflare Worker egress IPs are occasionally flagged by YouTube. Enable `WEBSHARE_PROXY` and `YT_COOKIE` to improve stability.
- **Gemini Regional Limits**: Some edge nodes cannot access Gemini directly. Use `CF_AIG_URL` with Cloudflare AI Gateway for bypass.

## Troubleshooting Endpoints
| Endpoint | Function |
|----------|----------|
| GET `/api/health` | Check all configurations (API keys, gateway, proxy, cookies) |
| GET `/api/debug/gemini` | Run a test request to Gemini and return raw response for fault diagnosis |
| GET `/api/session/:id` | View full cached session data for 5W1H issue debugging |

**Common Issues**
1. Page keeps loading: Likely Gemini regional restrictions → Configure AI Gateway.
2. Demo subtitle banner appears: Subtitle retrieval failed → Add proxy or YouTube login cookie.

## Directory Structure
```
.
├── public/                      # Build-free frontend (served by Workers Assets)
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── src/
│   ├── index.ts                 # Hono entry & API routes
│   ├── types.ts                 # Global type definitions
│   ├── utils/youtube.ts         # YouTube URL parsing
│   └── services/
│       ├── transcript.ts        # Multi-path subtitle retrieval
│       ├── proxyFetch.ts        # Forward proxy implementation
│       ├── gemini.ts            # Gemini stream & JSON requests + prompt logic
│       ├── markdown.ts          # Chapter splitting by headings
│       ├── session.ts           # KV session management
│       └── demoTranscript.ts    # Fallback demo subtitles
├── wrangler.toml
├── tsconfig.json
├── package.json
└── README.md
```

## Development Specifications
- Keep single source files around 400 lines. Prioritize native Web APIs over heavy frameworks or LLM SDKs.
- Run `npm run typecheck` after code changes (strict TypeScript mode enabled).
- Maintain build-free frontend; do not add bundlers.
- Store all secrets via `wrangler secret put` instead of writing them in configuration files.

## License
MIT
=======
## 📸 Demo Preview

| FastAPI Swagger UI | Streamlit Web Interface |
| :---: | :---: |
| <img width="2549" height="1403" alt="image" src="https://github.com/user-attachments/assets/656caecc-5bfd-44ff-884d-eee206c9768b" />| <img width="2487" height="1371" alt="image" src="https://github.com/user-attachments/assets/34520375-6196-4e1d-963d-68e7abe3f9b2" /> |

# Local Audio Preprocessing for Better ASR Performance

## Project Overview
This project consists of two core modules: Topic3 local audio preprocessing module and Topic1 Whisper-FastAPI transcription module.
Topic3 works as front-end cleaner for raw noisy audio, including noise reduction, voice segmentation and speech enhancement. Processed clean audio is fed into Whisper backend for transcription, subtitle generation, speaker diarization, LLM meeting summary and RAG database integration.

Built on Faster-Whisper, FastAPI and Streamlit, the system supports single-file upload and batch folder transcription, multi-language recognition, SRT & TXT subtitle export. It contains 5 noise reduction algorithms, 4 VAD detection methods, 5 audio enhancement techniques and 5 scene-oriented preset configurations.

FastAPI Swagger UI Link: https://github.com/user-attachments/assets/656caecc-5bfd-44ff-884d-eee206c9768b
Streamlit Web Interface Link: https://github.com/user-attachments/assets/34520375-6196-4e1d-963d-68e7abe3f9b2
SRT Subtitle Preview Link: https://github.com/user-attachments/assets/30177683-938a-4f7a-b3be-2491320b9a43

## Core Features
1. Batch processing: One-click full folder audio transcription
2. Single file upload: Drag-and-drop media upload for independent recognition
3. Multi-language: Supports Chinese, English, Japanese, Korean, French, German and more
4. Multi-format export: Generate SRT subtitle and plain TXT file
5. Offline model: Load local Whisper checkpoint to avoid online download
6. Visual dashboard: Streamlit based parameter configuration & task monitor
7. Dedicated preprocessing page: Preview and download denoised audio with all preset options
8. Contrast test: Compare original and enhanced transcription results to verify improvement

## Environment Prerequisite
1. Python 3.8 or above
2. FFmpeg for media decoding

Windows install command: winget install ffmpeg
Check installation: ffmpeg -version

## Modified Source Files
src/utils/audio_utils.py: Add mp4/mkv support, BytesIO save and ffmpeg exception handler
src/preprocessing/noise_reduction.py: Fix redundant parameter passing
src/preprocessing/voice_activity_detection.py: Replace default Silero VAD with spectral entropy VAD
src/preprocessing/pipeline.py: Set SPECTRAL_ENTROPY as default VAD for all presets
web/backend_whisper.py: Auto project root detect, temp file clean, cache model into web/models
web/frontend_whisper.py: New Tab3 preprocess & Tab4 comparison page, mp4 upload available
web/requirements.txt & root requirements.txt: Fix ASCII encoding error
setup.py: Support local install via pip install -e .

## Dependency Installation
cd local-audio-preprocessing-asr/web
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
pip install torch torchvision torchaudio -i https://pypi.tuna.tsinghua.edu.cn/simple

### Domestic HF Mirror (Windows Only)
set HF_ENDPOINT=https://hf-mirror.com

### Run Service
Terminal1(Backend): uvicorn backend_whisper:app --port 8000
API Doc: http://127.0.0.1:8000/docs

Terminal2(Frontend): streamlit run frontend_whisper.py
Frontend Page: http://localhost:8501

### Frontend Tab Intro
Tab1: Batch transcription for full folder
Tab2: Single file upload & export subtitle
Tab3: Noise reduction + download clean audio
Tab4: Original VS enhanced transcription comparison

## Common Troubleshooting
1. No module named src: run pip install -e .. under web folder
2. FFmpeg missing: install ffmpeg and add to system PATH
3. Slow model download: enable HF mirror or put pre-download model into web/models
4. Slow inference: switch to mobile / lightweight preset
5. Bad result under heavy noise: use lightweight preset and disable aggressive noise reduction

# Project Report: Local Audio Preprocessing for Better ASR Performance
## 1 Introduction
Modern ASR models perform well on clean lab audio but degrade severely under real-world noise, room reverberation and inconsistent recording gain. This project develops lightweight front-end preprocessing to lift ASR accuracy without modifying original recognition model.

### 1.1 Motivation
Retrain large ASR model costs huge compute resource. Preprocessing is low-cost, low-latency, cross-model compatible and edge-deployable.

### 1.2 Scope
Three categories of preprocessing are implemented and evaluated:
1. Five noise reduction algorithms
2. Four VAD methods
3. Five speech enhancement techniques

Metrics: WER/CER for accuracy, RTF for real-time speed, SNR robustness test.

## 2 Technical Approach
### 2.1 Noise Reduction
- Spectral Gating: Noise profile from non-speech segment, best overall quality
- Spectral Subtraction: Classic fast algorithm, easy implement
- Wiener Filter: MMSE optimal filter for smooth output
- Kalman Filter: Tiny footprint for embedded real-time
- Multi-band Spectral Subtraction: Band-wise subtract to preserve speech formant

### 2.2 VAD
- Energy VAD: Simple threshold for quiet scene
- Silero VAD: High accuracy small pre-trained NN
- WebRTC VAD: Ultra-light for real-time call
- Spectral Entropy VAD: Zero-training universal solution

### 2.3 Speech Enhancement
- DRC: Compress dynamic volume range
- Optimized EQ: Telephone / Clarity / Warmth three preset
- AGC: Auto normalize audio RMS level
- De-essing: Cut harsh high-frequency sibilant noise
- Dereverberation: Suppress late room echo

### 2.4 Pipeline & Preset
Workflow: Raw Audio → VAD → Noise Reduction → Enhancement → Clean Audio

Five scene preset: mobile / lightweight / desktop_high_quality / noisy_environment / meeting_room

## 3 Experiment Result
Best improvement range: 8~20dB SNR, WER drops 15%~40%. Below 5dB, over-denoise hurts speech and reduces accuracy.
Lightweight algorithm like Kalman runs near real-time; VAD saves 30%~60% ASR compute by cutting silence segment.

## 4 Conclusion & Future Work
### Conclusion
Front preprocessing effectively improves noisy ASR result. AGC+VAD is the most cost-effective universal combination.

### Limitation & Future
Current test uses synthetic noise and English corpus only. Future work: adaptive SNR auto-switch, neural denoise, multi-lingual optimize, mobile deployment.

## References
- Boll, S. (1979). Suppression of acoustic noise in speech using spectral subtraction. IEEE Trans. ASSP
- Scalart, P. & Filho, J. (1996). Speech enhancement based on a priori SNR estimation. ICASSP
- Ephraim, Y. & Malah, D. (1984). MMSE speech enhancement. IEEE Trans. ASSP
- Silero Team. Silero VAD
- Google WebRTC VAD
- Radford et al. Whisper ICML 2023
- Sainburg T. noisereduce
>>>>>>> 6ec9eff24d8ef7e74b270266bcb979948653b97d
