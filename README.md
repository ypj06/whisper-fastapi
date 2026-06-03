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