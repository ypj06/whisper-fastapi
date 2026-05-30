# Whisper Transcription Tool (FastAPI + Streamlit)

This project provides a simple web-based tool for transcribing audio and video files using OpenAI's Whisper model, with a FastAPI backend and a Streamlit frontend.

---

## 📸 Demo Preview

## 📸 Demo Preview

| FastAPI Swagger UI | Streamlit Web Interface |
| :---: | :---: |
| <img width="2549" height="1403" alt="image" src="https://github.com/user-attachments/assets/e7495da9-3e9f-4540-a724-eadf4ea7c82a" />
> | <img alt="Streamlit UI" src="https://github.com/user-attachments/assets/7da66262-565c-4ffe-96e2-63ac08831024"> |

#### Generated SRT Subtitle File & Video Playback
<img alt="Subtitle Result" src="https://github.com/user-attachments/assets/30177683-938a-4f7a-b3be-2491320b9a43">


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





