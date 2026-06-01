# Whisper Transcription Tool (FastAPI + Streamlit)
This project provides a web-based tool for transcribing and translating audio/video files using OpenAI's Whisper model (via faster-whisper). It includes:
- A FastAPI backend for handling transcription/translation logic, model loading, and batch processing
- A Streamlit frontend for intuitive web-based interaction
- Integration with Baidu Translation API for subtitle translation
- Support for local Whisper model loading (avoid network dependencies)
- CUDA/CPU compatibility for model inference

## ✨ Key Features
- **Batch Directory Processing**: Transcribe all media files in a folder (supports MP4/MKV/WebM/FLV/MP3/WAV/M4A)
- **Single File Upload**: Upload and transcribe individual audio/video files via web interface
- **Multi-language Support**: Transcription for English/Chinese/Japanese/Korean/French/German (see `LANG_MAP` in backend code)
- **Subtitle Translation**: Integrates Baidu Translation API to translate transcribed subtitles to target languages
- **Dual Output Formats**: Generate SRT subtitle files and plain text (.txt) files
- **Local Model Loading**: Load Whisper models from local path (no need for online download)
- **CUDA Acceleration**: Auto-detects CUDA (uses float16) or falls back to CPU (int8)
- **VAD Filter**: Voice Activity Detection for more accurate transcription (enabled by default)
- **Overwrite Control**: Optional overwrite of existing output files (batch processing)
- **API Access**: RESTful API for programmatic integration (Swagger UI included)

## 📁 Project Structure
```
whisper-fastapi/
├── backend_whisper.py    # FastAPI backend (model loading, transcription/translation, API endpoints)
├── frontend_whisper.py   # Streamlit frontend (web UI for batch/single file processing)
├── .env                  # Environment variables (Baidu Translation API keys, optional)
└── requirements.txt      # Python dependencies (faster-whisper, FastAPI, Streamlit, etc.)
```

## 🛠️ Prerequisites
1. **Python 3.8+**: Ensure Python 3.8 or higher is installed (check with `python --version` or `python3 --version`)
2. **FFmpeg**: Required by `faster-whisper` for media processing
   - Windows: Download FFmpeg from [ffmpeg.org](https://ffmpeg.org/), extract, and add the `bin` folder to system PATH
   - Linux: `sudo apt update && sudo apt install ffmpeg`
   - macOS: `brew install ffmpeg`
3. **CUDA (Optional)**: For GPU acceleration (recommended for large models)
   - Install CUDA Toolkit 11.7+ (matches PyTorch's CUDA support)
   - Verify installation with `nvcc --version` (GPU only)
4. **Baidu Translation API (Optional)**: For subtitle translation feature
   - Create an app on [Baidu Translation Open Platform](https://fanyi-api.baidu.com/) to get `APP_ID` and `APP_KEY`
5. **Local Whisper Model**: Place your downloaded Whisper model files in the path specified in `backend_whisper.py`
   - Default path: `D:\OneDrive\桌面\whisper-fastapi`
   - You can modify this path later in the backend code

## 🚀 Installation & Setup
### 1. Clone the Repository (skip if you already have the files locally)
```bash
git clone https://github.com/your-username/whisper-fastapi.git
cd whisper-fastapi
```

### 2. Install Python Dependencies
This step installs all required libraries for both the FastAPI backend and Streamlit frontend.

1. Open a terminal in the project root directory (you should see `backend_whisper.py` and `frontend_whisper.py` here)
2. Run the following command (use the Tsinghua mirror for faster download in China):
   ```bash
   # For Chinese users (recommended, 10x faster)
   pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
   
   # For international users
   pip install -r requirements.txt 
