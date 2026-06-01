# How to Give This Project to Someone Else

---

## Files Modified by This Project

| File | What changed |
|------|-------------|
| `src/utils/audio_utils.py` | Added `.mp4`/`.mkv` video support, `BytesIO` saving, ffmpeg error handling |
| `src/preprocessing/noise_reduction.py` | Fixed cross-method parameter passing (`inspect` filtering) |
| `src/preprocessing/voice_activity_detection.py` | Same fix. Default VAD changed from Silero to Spectral Entropy (no download needed) |
| `src/preprocessing/pipeline.py` | VAD method switched to `SPECTRAL_ENTROPY` in all presets |
| `web/backend_whisper.py` | Auto-detect project root (any folder layout), safe temp file cleanup, default `base` model, model cached in `web/models/` |
| `web/frontend_whisper.py` | Added Tab 3 (audio preprocessing) and Tab 4 (preprocess + transcribe compare). Accepts `.mp4` files |
| `web/requirements.txt` | Pure ASCII, no encoding issues |
| `requirements.txt` | Pure ASCII, no encoding issues |
| `web/SETUP.md` | This guide |
| `setup.py` | `pip install -e .` support |

---

## Step-by-Step: Get Everything Running (Other Person's Computer)

### First: What They Need Before Starting

1. **Python 3.8 or newer**
2. **ffmpeg** (required for `.mp4` video files and Whisper)

Install ffmpeg:

```bash
# Windows (pick one):
winget install ffmpeg
# or: choco install ffmpeg
# or: download from https://ffmpeg.org and add bin/ to PATH

# Verify it worked:
ffmpeg -version
```

---

### Step 1: Give Them the Folder

Copy the entire project folder (for example `local-audio-preprocessing-asr/`) to their computer. The folder should contain:

```
local-audio-preprocessing-asr/
├── src/                    <-- preprocessing engine
├── web/                    <-- frontend + backend
│   ├── models/
│   │   └── faster-whisper-base/   <-- Whisper model, already downloaded
│   ├── backend_whisper.py
│   ├── frontend_whisper.py
│   └── requirements.txt
├── requirements.txt
├── setup.py
└── ...
```

---

### Step 2: Open a Terminal

```bash
cd local-audio-preprocessing-asr/web
```

---

### Step 3: Install Python Dependencies

Two commands, in any order:

```bash
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
pip install torch torchvision torchaudio -i https://pypi.tuna.tsinghua.edu.cn/simple
```

> If you are NOT in China, remove the `-i https://pypi.tuna.tsinghua.edu.cn/simple` part.

---

### Step 4: Set HuggingFace Mirror (China Only)

```bash
# Windows
set HF_ENDPOINT=https://hf-mirror.com

# Mac / Linux
# export HF_ENDPOINT=https://hf-mirror.com
```

Skip this step if you already have the `web/models/faster-whisper-base/` folder with model files inside it.

---

### Step 5: Start the Backend

**Terminal 1:**

```bash
cd local-audio-preprocessing-asr/web
uvicorn backend_whisper:app --port 8000
```

Wait until you see:

```
✅ 从项目内置模型加载: .../web/models/faster-whisper-base
Uvicorn running on http://127.0.0.1:8000
```

> If the `web/models/` folder is missing or empty, the backend will auto-download
> the `base` model (~300 MB). This happens once. Set `HF_ENDPOINT` first (Step 4)
> for faster download in China.

---

### Step 6: Start the Frontend

**Terminal 2:**

```bash
cd local-audio-preprocessing-asr/web
streamlit run frontend_whisper.py
```

---

### Step 7: Open the Web App

Open your browser and go to: **http://localhost:8501**

You will see 4 tabs:

| Tab | What it does |
|-----|-------------|
| Tab 1 | Batch transcribe all media files in a folder |
| Tab 2 | Upload a single file and transcribe it |
| Tab 3 | Upload a noisy audio/video file, choose a preset, get clean audio back |
| Tab 4 | Upload a file, get BOTH the original and preprocessed transcription side-by-side |

---

## Quick Reference Card

```bash
# Terminal 1 — Backend
cd local-audio-preprocessing-asr/web
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
pip install torch torchvision torchaudio -i https://pypi.tuna.tsinghua.edu.cn/simple
set HF_ENDPOINT=https://hf-mirror.com
uvicorn backend_whisper:app --port 8000

# Terminal 2 — Frontend
cd local-audio-preprocessing-asr/web
streamlit run frontend_whisper.py

# Browser → http://localhost:8501
```

---

## Common Errors and Their Fixes

| Error | Fix |
|-------|-----|
| `ModuleNotFoundError: No module named 'src'` | `cd` into `web/` first, then run `pip install -e ..` |
| `FileNotFoundError: ffmpeg` | Install ffmpeg (see "Before Starting" above) |
| `UnicodeDecodeError: 'gbk'` | Already fixed — requirements.txt is pure ASCII now |
| `PermissionError: [WinError 32]` | Already fixed — temp files are cleaned up safely |
| `TypeError: got unexpected keyword argument` | Already fixed — all functions filter their kwargs |
