import os
import io
import glob
import hashlib
import random
import requests
from pathlib import Path
from typing import List, Optional
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import torch
from faster_whisper import WhisperModel
from dotenv import load_dotenv

load_dotenv()

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

# ========== 从环境变量读取密钥==========
BAIDU_APP_ID = os.getenv("BAIDU_APP_ID", "")
BAIDU_APP_KEY = os.getenv("BAIDU_APP_KEY", "")

# 语言映射：Whisper 码 -> 百度翻译码
LANG_MAP = {
    "zh": "zh",
    "en": "en",
    "ja": "jp",
    "ko": "kor",
    "fr": "fra",
    "de": "de"
}

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
    target_lang: Optional[str] = None
    vad_filter: bool = True

class BatchRequest(BaseModel):
    directory: str
    languages: List[str] = ["en"]
    target_lang: Optional[str] = None
    model_choice: int = 4
    gen_srt: bool = True
    gen_txt: bool = True
    overwrite: bool = False

# -------------------------- 百度翻译函数 --------------------------
def baidu_translate(text: str, source_lang: str, target_lang: str) -> str:
    if not BAIDU_APP_ID or not BAIDU_APP_KEY:
        print("❌ 百度翻译密钥未配置，请检查 .env 文件")
        return text

    src = LANG_MAP.get(source_lang, "auto")
    dst = LANG_MAP.get(target_lang, target_lang)
    print(f"📝 翻译请求：{src} → {dst}, 文本: {text}")

    # 百度翻译签名算法（官方标准）
    salt = random.randint(32768, 65536)
    sign_str = f"{BAIDU_APP_ID}{text}{str(salt)}{BAIDU_APP_KEY}"
    sign = hashlib.md5(sign_str.encode("utf-8")).hexdigest().lower()

    params = {
        "q": text,
        "from": src,
        "to": dst,
        "appid": BAIDU_APP_ID,
        "salt": salt,
        "sign": sign
    }

    try:
        url = "https://fanyi-api.baidu.com/api/trans/vip/translate"
        resp = requests.get(url, params=params, timeout=10)
        res = resp.json()
        print(f"📄 百度翻译返回结果: {res}")
        
        if "error_code" in res:
            print(f"❌ 百度翻译错误 [{res['error_code']}]: {res.get('error_msg', '未知错误')}")
            return text
            
        if "trans_result" in res:
            return res["trans_result"][0]["dst"]
        print(f"❌ 翻译失败，错误信息: {res}")
        return text
    except Exception as e:
        print(f"❌ 翻译请求异常: {e}")
        return text

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

# 原语言字幕
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

# 翻译后字幕
def generate_translated_srt(media_path: str, source_lang: str, target_lang: str) -> str:
    segments, _ = _model.transcribe(
        media_path, language=source_lang, task="transcribe", vad_filter=True
    )
    srt_lines = []
    for idx, seg in enumerate(segments, 1):
        start = format_timestamp(seg.start)
        end = format_timestamp(seg.end)
        raw_text = seg.text.strip()
        trans_text = baidu_translate(raw_text, source_lang, target_lang)
        srt_lines.append(f"{idx}\n{start} --> {end}\n{trans_text}\n\n")
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
    init_model(4)

@app.get("/")
def root():
    return {"status": "running", "device": _device}

# 单文件上传接口
@app.post("/transcribe/file")
async def transcribe_file(
    file: UploadFile = File(...),
    language: str = "en",
    target_lang: Optional[str] = None,
    output_format: str = "both"
):
    if _model is None:
        raise HTTPException(status_code=500, detail="Model not loaded")

    temp_path = f"temp_{file.filename}"
    with open(temp_path, "wb") as f:
        f.write(await file.read())

    try:
        result = {}
        if output_format in ["srt", "both"]:
            if target_lang:
                result["srt"] = generate_translated_srt(temp_path, language, target_lang)
            else:
                result["srt"] = generate_srt(temp_path, language)

        if output_format in ["txt", "both"]:
            result["txt"] = generate_plain_text(temp_path, language)

        return {"filename": file.filename, **result}
    finally:
        os.remove(temp_path)

# 批量目录接口
@app.post("/transcribe/batch")
def transcribe_batch(req: BatchRequest):
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
                if req.target_lang:
                    srt_path = os.path.join(req.directory, f"{stem}_{req.target_lang}.srt")
                    if os.path.exists(srt_path) and not req.overwrite:
                        log.append(f"  [{lang} → {req.target_lang}] Translated SRT skipped")
                    else:
                        srt_content = generate_translated_srt(file_path, lang, req.target_lang)
                        with open(srt_path, "w", encoding="utf-8") as f:
                            f.write(srt_content)
                        log.append(f"  [{lang} → {req.target_lang}] Translated SRT saved")
                else:
                    srt_path = os.path.join(req.directory, f"{stem}.srt")
                    if os.path.exists(srt_path) and not req.overwrite:
                        log.append(f"  [{lang}] Original SRT skipped")
                    else:
                        srt_content = generate_srt(file_path, lang)
                        with open(srt_path, "w", encoding="utf-8") as f:
                            f.write(srt_content)
                        log.append(f"  [{lang}] Original SRT saved")

            if req.gen_txt:
                txt_path = os.path.join(req.directory, f"{stem}_{lang}.txt")
                if os.path.exists(txt_path) and not req.overwrite:
                    log.append(f"  [{lang}] TXT skipped")
                else:
                    txt_content = generate_plain_text(file_path, lang)
                    with open(txt_path, "w", encoding="utf-8") as f:
                        f.write(txt_content)
                    log.append(f"  [{lang}] TXT saved")
    return {"log": log}

@app.post("/model/load")
def load_model(model_choice: int = 4):
    global _model
    init_model(model_choice)
    return {"message": f"Model {MODEL_MAP[model_choice]} loaded on {_device}"}