# 实际操作完整流程：Topic 3 作为 Topic 1 的前端清洗工

## ⭐ 推荐方式：Web 界面操作（无需命令行）

```bash
# 1. 打开终端，进入项目目录
cd D:\claude\work\local-audio-preprocessing-asr

# 2. 安装依赖（仅需执行一次）
pip install -r requirements.txt

# 3. 启动网页应用
streamlit run app.py
```

浏览器会自动打开 `http://localhost:8501`。接下来的操作全部在网页上完成：

1. **上传音频** — 拖拽或点击上传你的录音文件（支持 WAV/MP3/M4A/FLAC）
2. **选择预设** — 在左侧边栏下拉框选择场景（mobile / meeting_room 等）
3. **点击按钮** — 点 "Run Preprocessing"
4. **查看对比** — 网页上显示原始 vs 处理后的波形图和频谱图
5. **试听对比** — 页面内嵌音频播放器，直接听前后效果
6. **下载结果** — 左侧边栏出现下载按钮，保存干净音频

> **前后端分工说明：** 所有音频处理（降噪、VAD、信号增强）必须在 Python **后端**运行，因为 librosa / scipy / noisereduce 这些库是 C 扩展，浏览器（前端）里不存在。Streamlit 自动帮你架起后端服务并在前端渲染界面，你只看到一个网页。

---

## 命令行方式（备选）

### 前提条件

```bash
# 1. 打开终端（PowerShell 或 CMD）
# 2. 进入项目目录
cd D:\claude\work\local-audio-preprocessing-asr

# 3. 安装依赖（仅需执行一次）
pip install -r requirements.txt

# 4. 验证安装成功
python -c "from src.preprocessing.pipeline import AudioPreprocessingPipeline; print('环境就绪')"
```

---

## 流程一：从零开始（没有真实音频时）

### 第1步：生成模拟的"多说话人会议录音"测试数据

```bash
python -m src.main generate --output-dir ./data/test
```

**你会看到：** 8个测试文件被生成，包括 clean.wav、不同噪声水平（SNR 0~20dB）和白噪声/粉红噪声的混合音频。

**验证：** 打开 `D:\claude\work\local-audio-preprocessing-asr\data\test\` 文件夹，确认有8个 `.wav` 文件。

---

### 第2步：运行 demo 看看预处理效果

```bash
python -m src.main demo
```

**你会看到：**
- `[1/5]` 生成测试音频
- `[2/5]` 4种预设（lightweight / mobile / desktop_high_quality / noisy_environment）逐一处理同一段噪声音频，显示处理时间
- `[3/5]` 生成一张对比图 `demo_comparison.png`（噪声 vs 处理后）
- `[4/5]` 估算 WER 改善（噪声下 ~35% → 处理后 ~18%，改善约 49%）
- `[5/5]` 各预设的实时性分析（RTF 值）

**验证：** 项目文件夹里出现 `demo_comparison.png`。

---

### 第3步：用"会议室"预设处理一条噪声测试音频

```bash
python -m src.main process ./data/test/white_noise_10db.wav ./data/test/cleaned_10db.wav --preset meeting_room
```

**你会看到：**
```
Loading: ./data/test/white_noise_10db.wav
Pipeline config: {...}
Processing complete in X.XXs
Output saved to: ./data/test/cleaned_10db.wav
Stats:
  input_duration_s: 10.0
  output_duration_s: X.X
  vad_segments: X
  processing_time_total_ms: XX
  noise_reduction_applied: True
  signal_enhancement_applied: True
```

**验证：** `cleaned_10db.wav` 出现在 `./data/test/` 里，听听看和原始文件的区别。

---

### 第4步：批量处理所有测试文件

```bash
# 创建输出目录
mkdir ./data/cleaned

# 批量处理
for %f in (.\data\test\*.wav) do python -m src.main process "%f" ".\data\cleaned\%~nxf" --preset meeting_room
```

**验证：** `./data/cleaned/` 里出现8个处理后的文件，一一对应原始文件。

---

## 流程二：处理真实的多说话人录音

### 第1步：把你的会议录音放到项目里

把你需要处理的 `.wav` / `.mp3` / `.m4a` 文件复制到：

```
D:\claude\work\local-audio-preprocessing-asr\data\raw\
```

（如果没有 `data\raw` 文件夹，创建一个）

---

### 第2步：处理单个会议录音

```bash
python -m src.main process ./data/raw/meeting_recording.wav ./data/cleaned/meeting_clean.wav --preset meeting_room
```

**如果文件是 mp3 格式：**
```bash
python -m src.main process ./data/raw/meeting_recording.mp3 ./data/cleaned/meeting_clean.wav --preset meeting_room
```

librosa 可以自动处理 mp3。

---

### 第3步：（进阶）在 Python 里直接跑完整管道

打开 Jupyter 或在 VS Code 里新建一个 Python 文件 `run_pipeline.py`：

```python
# ===================================================
# run_pipeline.py — 放在 D:\claude\work\local-audio-preprocessing-asr\
# ===================================================

import sys
sys.path.insert(0, ".")

from src.preprocessing.pipeline import AudioPreprocessingPipeline
from src.utils.audio_utils import load_audio, save_audio
import json

# ================= 配置 =================
INPUT_FILE  = "./data/raw/meeting_recording.wav"   # ← 改成你的文件
OUTPUT_FILE = "./data/cleaned/meeting_clean.wav"
PRESET      = "meeting_room"  # 可换: mobile / desktop_high_quality / noisy_environment
# =========================================

print(f"1. 加载音频: {INPUT_FILE}")
audio, sr = load_audio(INPUT_FILE, target_sr=16000)
print(f"   采样率: {sr} Hz, 时长: {len(audio)/sr:.1f}s")

print(f"2. 创建预处理管道 (预设: {PRESET})")
pipeline = AudioPreprocessingPipeline.from_preset(PRESET)

print(f"3. 运行预处理...")
clean_audio, stats = pipeline.process(audio, sr)

print(f"4. 保存干净音频: {OUTPUT_FILE}")
save_audio(clean_audio, OUTPUT_FILE, sr)

print(f"\n===== 预处理统计 =====")
for key, value in stats.to_dict().items():
    print(f"  {key}: {value}")

print(f"\n===== 完成 =====")
print(f"干净音频已保存到: {OUTPUT_FILE}")
print(f"现在可以将这个文件送入 Topic 1 的 Diarization / ASR / LLM 管道了。")
```

在终端运行：
```bash
python run_pipeline.py
```

---

## 流程三：连接到 Topic 1 下游管道

当你有了干净音频 (`meeting_clean.wav`)，把它交给 Topic 1 的工具：

### 3A. 送入 Speaker Diarization（pyannote 示例）

```bash
# 先安装 pyannote（如果还没装）
pip install pyannote.audio

# 创建 diarization.py
```

```python
# diarization.py
from pyannote.audio import Pipeline
import torch

# 加载 pyannote 模型
diarization = Pipeline.from_pretrained(
    "pyannote/speaker-diarization-3.1",
    use_auth_token="YOUR_HUGGINGFACE_TOKEN"  # 从 huggingface.co/settings/tokens 获取
)

# 对预处理后的干净音频做说话人分离
result = diarization("./data/cleaned/meeting_clean.wav")

# 输出结果
for turn, _, speaker in result.itertracks(yield_label=True):
    print(f"[{turn.start:.1f}s → {turn.end:.1f}s] {speaker}")
```

### 3B. 送入 ASR 转录（Whisper 示例）

```bash
# 安装 whisper
pip install openai-whisper
```

```python
# transcribe.py
import whisper

model = whisper.load_model("base")  # tiny / base / small / medium / large

# 转录预处理后的干净音频
result = model.transcribe("./data/cleaned/meeting_clean.wav", language="zh")
print(result["text"])
```

### 3C. 完整管道：预处理 → Diarization → ASR → LLM

把上述步骤串起来，创建 `full_pipeline.py`：

```python
# full_pipeline.py — 完整 Topic 3 + Topic 1 管道
import sys
sys.path.insert(0, ".")

from src.preprocessing.pipeline import AudioPreprocessingPipeline
from src.utils.audio_utils import load_audio
import numpy as np

# =================== 第1步: Topic 3 预处理 ===================
print("=" * 50)
print("第1步: 音频预处理 (Topic 3)")
print("=" * 50)

audio, sr = load_audio("./data/raw/meeting_recording.wav", target_sr=16000)
pipeline = AudioPreprocessingPipeline.from_preset("meeting_room")
clean_audio, stats = pipeline.process(audio, sr)

print(f"原始时长: {stats.input_duration:.1f}s → 处理后: {stats.output_duration:.1f}s")
print(f"检测到 {stats.vad_segments_detected} 个语音段")
print(f"处理耗时: {stats.processing_time_total*1000:.0f}ms")
print()

# =================== 第2步: Speaker Diarization ===================
print("=" * 50)
print("第2步: 说话人分离 (Topic 1a)")
print("=" * 50)

# 方式A: 用 pyannote
# from pyannote.audio import Pipeline
# diarization = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1")
# diarization_result = diarization({"waveform": torch.from_numpy(clean_audio).unsqueeze(0), "sample_rate": sr})

# 方式B: 用 simpler_diarizer（无需 token）
try:
    from resemblyzer import VoiceEncoder, preprocess_wav
    from spectralcluster import SpectralClusterer

    # 简化版：用 VAD 分段 + embedding + 聚类
    from src.preprocessing.voice_activity_detection import detect_voice_activity

    segments = detect_voice_activity(clean_audio, sr, method="energy")
    print(f"VAD 检测到 {len(segments)} 个语音段")
    for i, seg in enumerate(segments):
        print(f"  段{i+1}: {seg.start:.1f}s - {seg.end:.1f}s ({seg.end-seg.start:.1f}s)")
except ImportError:
    print("(安装 resemblyzer 和 spectralcluster 可运行简化版 diarization)")
    print("  pip install resemblyzer spectralcluster")

print()

# =================== 第3步: ASR 转录 ===================
print("=" * 50)
print("第3步: 语音识别 (Topic 1b)")
print("=" * 50)

try:
    import whisper
    model = whisper.load_model("base")
    result = model.transcribe(clean_audio.astype(np.float32), language="zh")
    transcript = result["text"].strip()
    print(f"转录结果: {transcript[:200]}..." if len(transcript) > 200 else f"转录结果: {transcript}")
except ImportError:
    print("(安装 openai-whisper 可运行 ASR)")
    print("  pip install openai-whisper")

print()

# =================== 第4步: LLM 后处理 ===================
print("=" * 50)
print("第4步: LLM 后处理 (Topic 1c) - 摘要 + 纠错")
print("=" * 50)

# 构建 LLM prompt（包含预处理元数据）
llm_prompt = f"""
You are a meeting assistant. Below is a transcript from a meeting recording.

Audio Quality Metadata:
- Recording quality: {'good' if stats.input_rms_db > -30 else 'poor'}
- Speech segments detected: {stats.vad_segments_detected}
- Noise reduction applied: {stats.noise_reduction_applied}
- Signal enhancement applied: {stats.signal_enhancement_applied}

Please:
1. Correct any obvious ASR errors considering the audio quality metadata
2. Summarize the key discussion points
3. List any action items or decisions

Transcript:
{transcript if 'transcript' in dir() else '(ASR not available — skipping)'}
"""
print("LLM Prompt 已构建（包含预处理元数据作为上下文）")
print(f"Prompt 长度: {len(llm_prompt)} 字符")
print()
print("=" * 50)
print("管道完成！")
print("=" * 50)
```

---

## 流程四：跑完整 Benchmark 看数值

```bash
python -m src.main benchmark --output-dir ./results
```

输出文件 `./results/benchmark_report.json` 包含详细的 WER/CER 对比数据。

---

## 流程五：跑单元测试确认一切正常

```bash
python -m pytest tests/ -v
```

或：

```bash
python -m unittest discover tests/
```

---

## 操作速查表

| 我想做什么 | 运行什么命令 |
|-----------|------------|
| 生成测试音频 | `python -m src.main generate` |
| 看效果演示 | `python -m src.main demo` |
| 处理一个文件 | `python -m src.main process 输入.wav 输出.wav --preset meeting_room` |
| 批量处理 | `for %f in (.\data\raw\*.wav) do python -m src.main process "%f" ".\data\cleaned\%~nxf" --preset meeting_room` |
| 跑 Benchmark | `python -m src.main benchmark --output-dir ./results` |
| 跑测试 | `python -m pytest tests/ -v` |
| Python 方式调用 | `pipeline = AudioPreprocessingPipeline.from_preset("meeting_room")`<br>`clean_audio, stats = pipeline.process(audio, sr)` |

---

## 文件流向图

```
你的原始录音 (*.wav / *.mp3)
    │
    │  放进 data/raw/
    ▼
┌─────────────────────────────────────────┐
│  python -m src.main process             │
│  --preset meeting_room                  │  这是 Topic 3 的工作
│                                         │
│  输出: data/cleaned/xxx_clean.wav       │
└──────────────────┬──────────────────────┘
                   │
                   │  干净音频
                   ▼
┌─────────────────────────────────────────┐
│  Topic 1 工具:                          │
│  - pyannote (Diarization)               │  这是 Topic 1 的工作
│  - whisper (ASR)                        │
│  - GPT/Claude (LLM 后处理)              │
│  - 向量数据库 (RAG)                     │
└─────────────────────────────────────────┘
```

---

## 常见问题

**Q: 我没有真实的多说话人录音怎么办？**
先用 `python -m src.main generate` 生成测试数据练手，流程完全一样。

**Q: 报错 "No module named 'librosa'"？**
运行 `pip install -r requirements.txt` 安装所有依赖。

**Q: 处理速度太慢？**
换用 `--preset mobile` 或 `--preset lightweight`。

**Q: 想调整降噪强度？**
在 Python 代码中修改 `PreprocessingConfig`：
```python
from src.preprocessing.pipeline import PreprocessingConfig
config = PreprocessingConfig()
config.noise_reduction_prop_decrease = 0.95  # 更激进 (默认 0.85)
config.enable_deess = True                    # 开启去齿音
pipeline = AudioPreprocessingPipeline(config)
```
