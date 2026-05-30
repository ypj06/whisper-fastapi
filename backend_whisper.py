import os
import io
import glob
import base64
import numpy as np
from pathlib import Path
from typing import List, Optional
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import torch
from faster_whisper import WhisperModel

# -------------------------- 全局配置 --------------------------
os.environ["TOKENIZERS_PARALLELISM"] = "false"
os.environ["USE_TORCH"] = "1"
os.environ["USE_TF"] = "0"

MODEL_MAP = {
    1: "tiny",
    2: "base",
    3: "small",
    4: "medium",
    5: "large-v1",
    6: "large-v2",
    7: "large-v3",
}

MEDIA_EXTS = ["*.mp4", "*.mkv", "*.webm", "*.flv", "*.mp3", "*.wav", "*.m4a"]

# 全局模型缓存
_model: Optional[WhisperModel] = None
_device = "cuda" if torch.cuda.is_available() else "cpu"
_compute_type = "float16" if torch.cuda.is_available() else "int8"

# -------------------------- FastAPI 初始化 --------------------------
app = FastAPI(title="Whisper Transcription API", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# -------------------------- 数据模型 --------------------------
class TranscribeRequest(BaseModel):
    language: str = "en"
    vad_filter: bool = True

class BatchRequest(BaseModel):
    directory: str
    languages: List[str] = ["en"]
    model_choice: int = 4
    gen_srt: bool = True
    gen_txt: bool = True
    overwrite: bool = False

# -------------------------- 工具函数 --------------------------
def init_model(model_choice: int = 4):
    global _model
    if _model is not None:
        return
    local_model_path = r"D:\OneDrive\桌面\whisper-fastapi"
    _model = WhisperModel(local_model_path, device=_device, compute_type=_compute_type)
    print(f"✅ 已从本地加载模型: {local_model_path}")

def format_timestamp(seconds: float) -> str:
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    sec = seconds % 60
    ms = int((sec - int(sec)) * 1000)
    return f"{hours:02d}:{minutes:02d}:{int(sec):02d},{ms:03d}"

def generate_srt(media_path: str, lang: str) -> str:
    segments, _ = _model.transcribe(
        media_path, language=lang, task="transcribe", vad_filter=True
    )
    srt_lines = []
    for idx, seg in enumerate(segments, 1):
        start = format_timestamp(seg.start)
        end = format_timestamp(seg.end)
        text = seg.text.strip()
        srt_lines.append(f"{idx}\n{start} --> {end}\n{text}\n\n")
    return "".join(srt_lines)

def generate_plain_text(media_path: str, lang: str) -> str:
    segments, _ = _model.transcribe(
        media_path, language=lang, task="transcribe", vad_filter=True
    )
    return "\n".join(seg.text.strip() for seg in segments)

def scan_media_files(directory: str) -> List[str]:
    if not os.path.isdir(directory):
        raise HTTPException(status_code=400, detail="Directory not found")
    files = []
    for ext in MEDIA_EXTS:
        files.extend(glob.glob(os.path.join(directory, ext)))
    return files

# -------------------------- API 接口 --------------------------
@app.on_event("startup")
def startup_event():
    init_model(4)  # 默认加载 medium 模型

@app.get("/")
def root():
    return {"status": "running", "device": _device}

@app.post("/transcribe/file")
async def transcribe_file(
    file: UploadFile = File(...),
    language: str = "en",
    output_format: str = "both"  # "srt" / "txt" / "both"
):
    """上传单个音视频文件，返回 SRT/纯文本"""
    if _model is None:
        raise HTTPException(status_code=500, detail="Model not loaded")

    # 保存临时文件
    temp_path = f"temp_{file.filename}"
    with open(temp_path, "wb") as f:
        f.write(await file.read())

    try:
        result = {}
        if output_format in ["srt", "both"]:
            result["srt"] = generate_srt(temp_path, language)
        if output_format in ["txt", "both"]:
            result["txt"] = generate_plain_text(temp_path, language)
        return {"filename": file.filename, **result}
    finally:
        os.remove(temp_path)

@app.post("/transcribe/batch")
def transcribe_batch(req: BatchRequest):
    """批量处理目录下的所有音视频文件"""
    if _model is None:
        raise HTTPException(status_code=500, detail="Model not loaded")

    media_files = scan_media_files(req.directory)
    if not media_files:
        return {"message": "No media files found"}

    log = []
    for file_path in media_files:
        stem = Path(file_path).stem
        log.append(f"Processing: {os.path.basename(file_path)}")
        for lang in req.languages:
            if req.gen_srt:
                srt_path = os.path.join(req.directory, f"{stem}.srt")
                if os.path.exists(srt_path) and not req.overwrite:
                    log.append(f"  [{lang}] SRT skipped (exists)")
                else:
                    srt_content = generate_srt(file_path, lang)
                    with open(srt_path, "w", encoding="utf-8") as f:
                        f.write(srt_content)
                    log.append(f"  [{lang}] SRT saved: {os.path.basename(srt_path)}")

            if req.gen_txt:
                txt_path = os.path.join(req.directory, f"{stem}_{lang}.txt")
                if os.path.exists(txt_path) and not req.overwrite:
                    log.append(f"  [{lang}] TXT skipped (exists)")
                else:
                    txt_content = generate_plain_text(file_path, lang)
                    with open(txt_path, "w", encoding="utf-8") as f:
                        f.write(txt_content)
                    log.append(f"  [{lang}] TXT saved: {os.path.basename(txt_path)}")
    return {"log": log}

@app.post("/model/load")
def load_model(model_choice: int = 4):
    """手动切换/加载模型"""
    global _model
    init_model(model_choice)
    return {"message": f"Model {MODEL_MAP[model_choice]} loaded on {_device}"}