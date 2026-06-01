import os
import io
import sys
import glob
import base64
import tempfile
import numpy as np
from pathlib import Path
from typing import List, Optional
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import torch
from faster_whisper import WhisperModel

# ── 导入音频预处理管道 (Topic 3) ──
# ============================================================
# 自动定位项目根目录（包含 src/ 的文件夹）。
# 支持多种运行场景：直接运行 / 从别处启动 / 只 clone 了 web 文件夹。
# ============================================================

def _find_project_root() -> Path:
    """
    从当前文件位置向上查找包含 src/preprocessing/pipeline.py 的目录。
    支持多种目录结构：

      🌟 你的电脑:  web/ 在项目根内
          local-audio-preprocessing-asr/
          ├── src/
          └── web/              ← backend_whisper.py

      🌟 别人的电脑:  web/ 与项目根并列
          some-folder/
          ├── local-audio-preprocessing-asr/
          │   └── src/
          └── web/              ← backend_whisper.py

    采用多策略回退：
      1) ../src/                        （web 在项目根内）
      2) 向上遍历祖先直接找 src/
      3) 向上遍历祖先的兄弟目录找 src/   （web 与项目根并列）
    如果全部失败，打印清晰错误信息告知用户如何修复。
    """
    this_file = Path(__file__).resolve()
    marker = Path("src/preprocessing/pipeline.py")

    # ── 策略 1: web/ 就在项目根里面 ──
    candidate = this_file.parent.parent
    if (candidate / marker).exists():
        return candidate

    # ── 策略 2: web/ 在嵌套目录里，祖先自身有 src/ ──
    for ancestor in this_file.parents:
        if (ancestor / marker).exists():
            return ancestor

    # ── 策略 3: web/ 与 local-audio-preprocessing-asr/ 并列 ──
    for ancestor in this_file.parents:
        try:
            for subdir in ancestor.iterdir():
                if subdir.is_dir() and (subdir / marker).exists():
                    return subdir
        except PermissionError:
            continue

    # ── 全部失败 — 打印修复指南 ──
    raise RuntimeError(
        "\n" + "=" * 65 + "\n"
        "  无法找到 src/ 模块（Topic 3 音频预处理管道）\n"
        "  " + "-" * 55 + "\n"
        "  当前文件位置: {}\n".format(str(this_file)) +
        "  期望找到:     .../src/preprocessing/pipeline.py\n"
        "\n"
        "  🔧 请选择以下任一方法修复：\n"
        "  ─────────────────────────────────────────────\n"
        "  方法 1: 把 web/ 放到项目根里\n"
        "    local-audio-preprocessing-asr/\n"
        "    ├── src/\n"
        "    └── web/   ← 把 web 文件夹移到这里面\n"
        "\n"
        "  方法 2: 用 pip 安装项目\n"
        "    cd local-audio-preprocessing-asr\n"
        "    pip install -e .\n"
        "    然后从任何目录运行 uvicorn backend_whisper:app\n"
        "\n"
        "  方法 3: 设置 PYTHONPATH 指向项目根\n"
        "    Windows: set PYTHONPATH=路径\\local-audio-preprocessing-asr\n"
        "    Mac/Linux: export PYTHONPATH=路径/local-audio-preprocessing-asr\n"
        "\n"
        "=" * 65 + "\n"
    )


_PROJECT_ROOT = _find_project_root()
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from src.utils.audio_utils import load_audio, save_audio
from src.preprocessing.pipeline import (
    AudioPreprocessingPipeline, PreprocessingConfig,
    PRESETS, VadMethod, NoiseReductionMethod,
)

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

# ── 预处理相关数据模型 (Topic 3) ──
class PreprocessRequest(BaseModel):
    """预处理请求：通过 API 传参覆盖预设"""
    preset: str = "meeting_room"         # mobile / desktop_high_quality / noisy_environment / meeting_room / lightweight
    enable_vad: Optional[bool] = None    # None = 使用预设默认值
    enable_nr: Optional[bool] = None
    enable_se: Optional[bool] = None
    nr_strength: Optional[float] = None  # 0.0 ~ 1.0

class PreprocessAndTranscribeRequest(BaseModel):
    """预处理 + 转写一体化请求"""
    preset: str = "meeting_room"
    language: str = "en"
    output_format: str = "txt"  # srt / txt / both
    enable_vad: Optional[bool] = None
    enable_nr: Optional[bool] = None
    enable_se: Optional[bool] = None
    nr_strength: Optional[float] = None

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

# ────────────────────────────────────────────────────────────
#  音频预处理工具函数 (Topic 3)
# ────────────────────────────────────────────────────────────

def _build_preprocessing_pipeline(req: PreprocessRequest) -> AudioPreprocessingPipeline:
    """根据请求参数构建预处理管道"""
    if req.preset not in PRESETS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown preset '{req.preset}'. Available: {list(PRESETS.keys())}"
        )

    preset_config = PRESETS[req.preset]

    # 以预设为基础，应用覆盖参数
    config = PreprocessingConfig()
    for attr in [
        "enable_vad", "vad_method", "vad_threshold",
        "vad_min_speech_duration", "vad_min_silence_duration",
        "enable_noise_reduction", "noise_reduction_method",
        "noise_reduction_n_fft", "noise_reduction_hop_length",
        "enable_signal_enhancement", "enable_drc",
        "enable_eq", "eq_preset", "enable_agc",
        "enable_deess", "enable_dereverb", "target_sr",
    ]:
        setattr(config, attr, getattr(preset_config, attr))

    # 应用用户覆盖
    if req.enable_vad is not None:
        config.enable_vad = req.enable_vad
    if req.enable_nr is not None:
        config.enable_noise_reduction = req.enable_nr
    if req.enable_se is not None:
        config.enable_signal_enhancement = req.enable_se
    if req.nr_strength is not None:
        config.noise_reduction_prop_decrease = max(0.0, min(1.0, req.nr_strength))

    return AudioPreprocessingPipeline(config)

def _transcribe_audio(audio: np.ndarray, sr: int, language: str, output_format: str = "txt") -> dict:
    """对 numpy 音频数组执行 Whisper 转写"""
    if _model is None:
        raise HTTPException(status_code=500, detail="Whisper model not loaded")

    # 写到临时文件（faster-whisper 需要文件路径）
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        save_audio(audio, tmp.name, sr)
        tmp_path = tmp.name

    try:
        result = {}
        if output_format in ["srt", "both"]:
            result["srt"] = generate_srt(tmp_path, language)
        if output_format in ["txt", "both"]:
            result["txt"] = generate_plain_text(tmp_path, language)

        # 也返回原始 segments 信息
        segments, _ = _model.transcribe(tmp_path, language=language, task="transcribe", vad_filter=True)
        result["segments"] = [
            {"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()}
            for s in segments
        ]
        return result
    finally:
        os.remove(tmp_path)

# ────────────────────────────────────────────────────────────
#  音频预处理 API 接口 (Topic 3 → Topic 1 桥梁)
# ────────────────────────────────────────────────────────────

@app.get("/preprocess/presets")
def list_presets():
    """列出所有可用的预处理预设及其配置"""
    return {
        name: {
            "vad": cfg.vad_method.value if cfg.enable_vad else "off",
            "noise_reduction": cfg.noise_reduction_method.value if cfg.enable_noise_reduction else "off",
            "drc": cfg.enable_drc,
            "eq": cfg.eq_preset if cfg.enable_eq else "off",
            "agc": cfg.enable_agc,
            "deess": cfg.enable_deess,
            "dereverb": cfg.enable_dereverb,
        }
        for name, cfg in PRESETS.items()
    }

@app.post("/preprocess/audio")
async def preprocess_audio(
    file: UploadFile = File(...),
    preset: str = "meeting_room",
    enable_vad: Optional[bool] = None,
    enable_nr: Optional[bool] = None,
    enable_se: Optional[bool] = None,
    nr_strength: Optional[float] = None,
):
    """
    对上传的音频文件进行预处理（降噪 + VAD + 信号增强）。

    返回：
    - processed_audio_base64: 处理后的音频（base64 编码的 WAV）
    - stats: 预处理统计信息
    - original_duration_s: 原始时长
    - processed_duration_s: 处理后时长
    """
    if file.filename is None:
        raise HTTPException(status_code=400, detail="No file uploaded")

    # 保存上传文件到临时路径
    with tempfile.NamedTemporaryFile(
        suffix=Path(file.filename).suffix, delete=False
    ) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    try:
        # 加载音频
        audio, sr = load_audio(tmp_path, target_sr=16000)

        # 构建管道
        req = PreprocessRequest(
            preset=preset,
            enable_vad=enable_vad,
            enable_nr=enable_nr,
            enable_se=enable_se,
            nr_strength=nr_strength,
        )
        pipeline = _build_preprocessing_pipeline(req)

        # 执行预处理
        processed, stats = pipeline.process(audio, sr)

        # 编码处理后的音频为 base64
        buf = io.BytesIO()
        save_audio(processed, buf, sr)
        buf.seek(0)
        audio_b64 = base64.b64encode(buf.read()).decode("utf-8")

        return {
            "filename": file.filename,
            "original_duration_s": round(stats.input_duration, 2),
            "processed_duration_s": round(stats.output_duration, 2),
            "sample_rate": sr,
            "processed_audio_base64": audio_b64,
            "stats": stats.to_dict(),
            "preset_used": preset,
        }
    finally:
        os.remove(tmp_path)


@app.post("/preprocess/audio/raw")
async def preprocess_audio_raw(
    file: UploadFile = File(...),
    preset: str = "meeting_room",
    enable_vad: Optional[bool] = None,
    enable_nr: Optional[bool] = None,
    enable_se: Optional[bool] = None,
    nr_strength: Optional[float] = None,
):
    """
    预处理音频，直接返回 WAV 二进制数据（适合浏览器 <audio> 标签直接播放）。
    返回 Content-Type: audio/wav
    """
    if file.filename is None:
        raise HTTPException(status_code=400, detail="No file uploaded")

    with tempfile.NamedTemporaryFile(
        suffix=Path(file.filename).suffix, delete=False
    ) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    try:
        audio, sr = load_audio(tmp_path, target_sr=16000)

        req = PreprocessRequest(
            preset=preset,
            enable_vad=enable_vad,
            enable_nr=enable_nr,
            enable_se=enable_se,
            nr_strength=nr_strength,
        )
        pipeline = _build_preprocessing_pipeline(req)
        processed, stats = pipeline.process(audio, sr)

        buf = io.BytesIO()
        save_audio(processed, buf, sr)
        buf.seek(0)

        from fastapi.responses import Response
        return Response(
            content=buf.read(),
            media_type="audio/wav",
            headers={
                "X-Original-Duration": str(round(stats.input_duration, 2)),
                "X-Processed-Duration": str(round(stats.output_duration, 2)),
                "X-Processing-Time-Ms": str(round(stats.processing_time_total * 1000, 1)),
                "X-Vad-Segments": str(stats.vad_segments_detected),
                "X-Preset": preset,
            },
        )
    finally:
        os.remove(tmp_path)


@app.post("/preprocess-and-transcribe")
async def preprocess_and_transcribe(
    file: UploadFile = File(...),
    preset: str = "meeting_room",
    language: str = "en",
    output_format: str = "both",
    enable_vad: Optional[bool] = None,
    enable_nr: Optional[bool] = None,
    enable_se: Optional[bool] = None,
    nr_strength: Optional[float] = None,
):
    """
    一体化接口：预处理 → Whisper 转写。

    先对音频降噪/增强，再送入 Whisper 转写。
    同时返回原始音频的转写结果作为对比基线。
    """
    if _model is None:
        raise HTTPException(status_code=500, detail="Whisper model not loaded")
    if file.filename is None:
        raise HTTPException(status_code=400, detail="No file uploaded")

    with tempfile.NamedTemporaryFile(
        suffix=Path(file.filename).suffix, delete=False
    ) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    try:
        audio, sr = load_audio(tmp_path, target_sr=16000)

        # ── 基线转写（原始音频）──
        baseline_transcript = _transcribe_audio(audio, sr, language, output_format)

        # ── 预处理 ──
        req = PreprocessRequest(
            preset=preset,
            enable_vad=enable_vad,
            enable_nr=enable_nr,
            enable_se=enable_se,
            nr_strength=nr_strength,
        )
        pipeline = _build_preprocessing_pipeline(req)
        processed, stats = pipeline.process(audio, sr)

        # ── 预处理后转写 ──
        enhanced_transcript = _transcribe_audio(processed, sr, language, output_format)

        return {
            "filename": file.filename,
            "preset_used": preset,
            "language": language,
            "stats": stats.to_dict(),
            "baseline": baseline_transcript,      # 原始音频的转写
            "enhanced": enhanced_transcript,       # 预处理后的转写
            "comparison": {
                "baseline_text": baseline_transcript.get("txt", ""),
                "enhanced_text": enhanced_transcript.get("txt", ""),
                "note": "Compare these two transcripts — enhanced should have fewer errors in noisy conditions."
            },
        }
    finally:
        os.remove(tmp_path)

# ────────────────────────────────────────────────────────────
#  原有 API 接口 (Whisper 转写)
# ────────────────────────────────────────────────────────────
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