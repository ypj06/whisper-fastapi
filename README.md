# Whisper Transcription Tool (FastAPI + Streamlit)

This project provides a simple web-based tool for transcribing audio and video files using OpenAI's Whisper model, with a FastAPI backend and a Streamlit frontend.

---

## 📸 Demo Preview

| FastAPI Swagger UI | Streamlit Web Interface |
| :---: | :---: |
| ![FastAPI Swagger UI](https://i.imgur.com/your-fastapi-image.png) | ![Streamlit UI](https://i.imgur.com/your-streamlit-image.png) |

| Transcription Result (SRT Subtitle) |
| :---: |
| ![Video with Generated Subtitles](https://i.imgur.com/your-video-subtitle-image.png) |

---

## ✨ Features
- **Batch directory processing**: Transcribe all media files in a folder at once
- **Single file upload**: Upload and transcribe individual files via the web interface
- **Multi-language support**: Supports transcription in English, Chinese, Japanese, Korean, French, German, etc.
- **Multiple output formats**: Generate both SRT subtitle files and plain text `.txt` files
- **Local model support**: Load Whisper models from local files to avoid network issues
- **User-friendly web UI**: Built with Streamlit for easy configuration and monitoring

---

## 📁 Project Structure
whisper-fastapi/
├── backend_whisper.py # FastAPI backend (model loading & transcription logic)
├── frontend_whisper.py # Streamlit frontend (web UI)
└── requirements.txt # Python dependencies


---

## 🛠️ Prerequisites
1. **Python 3.8+**
2. **FFmpeg**: Required by `faster-whisper` for media processing  
   - Windows: Download FFmpeg and add the `bin` folder to your system `PATH`
   - Linux: `sudo apt install ffmpeg`
   - macOS: `brew install ffmpeg`

---





