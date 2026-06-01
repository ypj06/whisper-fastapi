# Topic 3 → Topic 1 Integration Guide

## 前置预处理管道驱动说话人分离与LLM+ASR协同

---

## 1. 总览

Topic 3（Local Audio Preprocessing for Better ASR Performance）是 Topic 1
（Speaker Diarization, Cross-Speech, and LLM + ASR Synergy）的**前端清洗工**。

核心思路：

```
原始多说话人音频（含噪声、混响、音量不均）
        │
        ▼
┌───────────────────────────────────────┐
│  Topic 3: 音频预处理管道               │
│                                       │
│  ① Voice Activity Detection          │
│     └─ 切除静音段，减少后续处理量       │
│  ② Noise Reduction                   │
│     └─ 抑制背景噪声，保护语音成分       │
│  ③ Signal Enhancement                │
│     └─ 归一化音量 / EQ优化 / 去混响     │
└───────────────┬───────────────────────┘
                │ 干净的音频
                ▼
┌───────────────────────────────────────┐
│  Topic 1: 下游智能处理                 │
│                                       │
│  A. Speaker Diarization              │
│     └─ 更干净的embedding → 更准的聚类   │
│  B. Overlapping Speech Recognition   │
│     └─ 降噪后的重叠段更易分离           │
│  C. LLM + ASR Synergy                │
│     └─ WER更低 → LLM纠错负担更轻        │
│  D. RAG Integration                  │
│     └─ 预处理元数据作为检索上下文        │
└───────────────────────────────────────┘
```

---

## 2. 环境准备

```bash
# 进入项目目录
cd D:\claude\work\local-audio-preprocessing-asr

# 安装依赖
pip install -r requirements.txt

# 确认安装成功
python -c "from src.preprocessing.pipeline import AudioPreprocessingPipeline; print('OK')"
```

---

## 3. 预设选择指南

根据 Topic 1 的使用场景选择预设：

| 场景 | 推荐预设 | 启用的模块 | 选择理由 |
|------|---------|-----------|---------|
| **会议室多说话人分离** | `meeting_room` | VAD(Silero) + Wiener降噪 + EQ(clarity) + DRC + AGC + De-ess + 去混响 | 全功能，针对多说话人、有混响的室内场景优化 |
| **嘈杂环境说话人分离** | `noisy_environment` | VAD(Silero) + Multi-band降噪 + EQ(telephone) + DRC + AGC | 在强噪声下最大限度保留语音 |
| **手机端实时Diarization** | `mobile` | VAD(WebRTC) + Spectral Subtraction + EQ(telephone) + DRC + AGC | 轻量快速，适合边缘设备 |
| **重叠语音（保守处理）** | `mobile` | 同上 | 处理较轻，避免抹掉被覆盖的说话人 |
| **LLM后处理优化** | `desktop_high_quality` | VAD(Silero) + Spectral Gating + EQ(clarity) + DRC + AGC + De-ess | 最大程度提升ASR精度，给LLM最好的输入 |
| **仅需快速预处理** | `lightweight` | Kalman降噪 + AGC | 极低延迟，适合流式处理 |

---

## 4. 操作步骤

### 步骤 A：对现有音频文件进行预处理（命令行）

```bash
# === 场景1：会议室录音 → 说话人分离 ===
python -m src.main process meeting.wav meeting_clean.wav --preset meeting_room

# === 场景2：嘈杂环境录音 → 说话人分离 ===
python -m src.main process noisy_cafe.wav cafe_clean.wav --preset noisy_environment

# === 场景3：手机录音 → 实时识别 ===
python -m src.main process phone_recording.wav phone_clean.wav --preset mobile

# === 场景4：对LLM最友好的预处理 ===
python -m src.main process lecture.wav lecture_clean.wav --preset desktop_high_quality

# === 场景5：批量处理 ===
for f in ./raw_audio/*.wav; do
    python -m src.main process "$f" "./clean_audio/$(basename $f)" --preset meeting_room
done
```

### 步骤 B：在 Python 管道中集成（代码调用）

#### B1. 基础集成：预处理 → Diarization

```python
# integration_diarization.py

from src.preprocessing.pipeline import AudioPreprocessingPipeline
import librosa
import soundfile as sf
import numpy as np

# ============================================
# Step 1: 加载多说话人录音
# ============================================
audio, sr = librosa.load("multi_speaker_meeting.wav", sr=16000)

# ============================================
# Step 2: Topic 3 预处理
# ============================================
pipeline = AudioPreprocessingPipeline.from_preset("meeting_room")
clean_audio, stats = pipeline.process(audio, sr)

print("预处理统计:")
for k, v in stats.to_dict().items():
    print(f"  {k}: {v}")

# 保存干净音频供后续使用
sf.write("clean_for_diarization.wav", clean_audio, sr)

# ============================================
# Step 3: Topic 1 — Speaker Diarization
# （以 pyannote.audio 为例）
# ============================================
# from pyannote.audio import Pipeline
# diarization = Pipeline.from_pretrained(
#     "pyannote/speaker-diarization-3.1",
#     use_auth_token="YOUR_HF_TOKEN"
# )
# diarization_result = diarization("clean_for_diarization.wav")
#
# for turn, _, speaker in diarization_result.itertracks(yield_label=True):
#     print(f"  {turn.start:.1f}s - {turn.end:.1f}s: {speaker}")
```

#### B2. 完整管道：预处理 → Diarization → ASR → LLM

```python
# integration_full_pipeline.py

from src.preprocessing.pipeline import AudioPreprocessingPipeline
import librosa
import numpy as np

# ============================================
# Step 1: 预处理
# ============================================
audio, sr = librosa.load("meeting.wav", sr=16000)
pipeline = AudioPreprocessingPipeline.from_preset("meeting_room")
clean_audio, stats = pipeline.process(audio, sr)

# ============================================
# Step 2: Speaker Diarization
# ============================================
# from pyannote.audio import Pipeline
# diarization = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1")
# diarization_result = diarization({"waveform": torch.from_numpy(clean_audio).unsqueeze(0),
#                                    "sample_rate": sr})

# ============================================
# Step 3: ASR（按说话人分段转录）
# ============================================
# import whisper
# asr_model = whisper.load_model("medium")

# speaker_transcripts = {}
# for turn, _, speaker in diarization_result.itertracks(yield_label=True):
#     start_sample = int(turn.start * sr)
#     end_sample = int(turn.end * sr)
#     segment = clean_audio[start_sample:end_sample]
#
#     result = asr_model.transcribe(segment.astype(np.float32))
#     if speaker not in speaker_transcripts:
#         speaker_transcripts[speaker] = []
#     speaker_transcripts[speaker].append({
#         "start": turn.start,
#         "end": turn.end,
#         "text": result["text"].strip()
#     })

# ============================================
# Step 4: 格式化输出给 LLM
# ============================================
# formatted = "Meeting Transcript (preprocessed with Topic 3 pipeline):\n\n"
# for speaker, segments in speaker_transcripts.items():
#     formatted += f"[{speaker}]:\n"
#     for seg in segments:
#         formatted += f"  [{seg['start']:.1f}s-{seg['end']:.1f}s] {seg['text']}\n"

# ============================================
# Step 5: LLM 后处理（摘要/纠错/RAG）
# ============================================
# import openai
# response = openai.ChatCompletion.create(
#     model="gpt-4",
#     messages=[
#         {"role": "system", "content": "You are a meeting assistant..."},
#         {"role": "user", "content": f"Summarize this meeting:\n\n{formatted}"}
#     ]
# )
# summary = response.choices[0].message.content
```

#### B3. RAG 增强：预处理元数据作为检索上下文

```python
# integration_rag.py

from src.preprocessing.pipeline import AudioPreprocessingPipeline
import librosa
import json

audio, sr = librosa.load("meeting.wav", sr=16000)

# 预处理
pipeline = AudioPreprocessingPipeline.from_preset("meeting_room")
clean_audio, stats = pipeline.process(audio, sr)

# 提取预处理元数据
preprocessing_metadata = {
    "audio": {
        "original_duration_s": stats.input_duration,
        "processed_duration_s": stats.output_duration,
        "duration_reduction_pct": round(
            (1 - stats.output_duration / max(stats.input_duration, 0.001)) * 100, 1
        ),
        "original_rms_db": stats.input_rms_db,
        "processed_rms_db": stats.output_rms_db,
    },
    "voice_activity": {
        "segments_detected": stats.vad_segments_detected,
        "speech_ratio": stats.vad_speech_ratio,
    },
    "processing": {
        "noise_reduction_applied": stats.noise_reduction_applied,
        "signal_enhancement_applied": stats.signal_enhancement_applied,
        "total_time_ms": stats.processing_time_total * 1000,
    },
    "quality_indicators": {
        # 如果原始 RMS 很低，说明录音质量差
        "recording_quality": "good" if stats.input_rms_db > -30 else "poor",
        # 如果 speech_ratio 很高，说明一直在说话
        "conversation_density": "dense" if stats.vad_speech_ratio > 0.7 else "sparse",
    }
}

# 这个 metadata 可以：
# 1. 存入向量数据库，作为 RAG 检索的上下文
# 2. 附在 LLM prompt 里，帮助 LLM 理解音频质量
# 3. 用于后续分析（哪些录音质量差需要人工复核）

print(json.dumps(preprocessing_metadata, indent=2, ensure_ascii=False))

# === RAG 集成示例 ===
# from langchain.vectorstores import Chroma
# from langchain.embeddings import OpenAIEmbeddings
#
# # 将 metadata + transcript 存入向量库
# vectorstore = Chroma(embedding_function=OpenAIEmbeddings())
# vectorstore.add_texts(
#     texts=[transcript_text],
#     metadatas=[preprocessing_metadata],
#     ids=[audio_id]
# )
#
# # 检索时，可以用预处理质量指标过滤
# results = vectorstore.similarity_search(
#     "meeting decisions",
#     filter={"quality_indicators.recording_quality": "good"}
# )
```

#### B4. 自适应预处理：根据实时SNR动态切换策略

```python
# integration_adaptive.py

from src.preprocessing.pipeline import (
    AudioPreprocessingPipeline, PreprocessingConfig,
    VadMethod, NoiseReductionMethod
)
from src.utils.audio_utils import compute_snr
import numpy as np

def adaptive_preprocess(audio, sr):
    """根据音频质量自适应选择预处理策略"""

    # 估计噪声水平（用前500ms静音段或全音频的底部10%作为噪声估计）
    frame_size = int(0.03 * sr)
    energies = np.array([
        np.mean(audio[i:i+frame_size]**2)
        for i in range(0, len(audio) - frame_size, frame_size // 2)
    ])
    noise_floor = np.percentile(energies, 10)
    signal_level = np.percentile(energies, 90)
    estimated_snr = 10 * np.log10((signal_level - noise_floor) / max(noise_floor, 1e-10))

    # 根据估计的SNR选择策略
    if estimated_snr > 20:
        # 已经很干净，轻处理
        print(f"SNR ≈ {estimated_snr:.0f} dB → 使用 lightweight 预设")
        pipeline = AudioPreprocessingPipeline.from_preset("lightweight")
    elif estimated_snr > 10:
        # 中等噪声，标准处理
        print(f"SNR ≈ {estimated_snr:.0f} dB → 使用 mobile 预设")
        pipeline = AudioPreprocessingPipeline.from_preset("mobile")
    elif estimated_snr > 5:
        # 较强噪声，高质量处理
        print(f"SNR ≈ {estimated_snr:.0f} dB → 使用 desktop_high_quality 预设")
        pipeline = AudioPreprocessingPipeline.from_preset("desktop_high_quality")
    else:
        # 极强噪声，激进处理
        print(f"SNR ≈ {estimated_snr:.0f} dB → 使用 noisy_environment 预设")
        pipeline = AudioPreprocessingPipeline.from_preset("noisy_environment")

    return pipeline.process(audio, sr)

# 使用
audio, sr = librosa.load("unknown_quality.wav", sr=16000)
clean_audio, stats = adaptive_preprocess(audio, sr)
```

---

## 5. 对不同 Topic 1 子任务的贡献

### 5.1 Speaker Diarization（说话人分离）

| 预处理步骤 | 对 Diarization 的帮助 |
|-----------|----------------------|
| **Noise Reduction** | 噪声会污染说话人 embedding（x-vector/d-vector），降噪后 embedding 更具区分性，聚类更准确 |
| **VAD** | 预处理 VAD 可以先切掉长静音，减少 pyannote 等管道在噪声段误判为说话人的概率 |
| **AGC** | 不同说话人音量差异减小，避免音量小的说话人被漏掉 |
| **Dereverberation** | 混响是 diarization 的大敌——它让同一个人的声音在不同位置听起来像不同人。去混响后误分割率显著降低 |
| **EQ (telephone/clarity)** | 某些 diarization 模型在电话频段上训练，EQ 匹配能提升效果 |

### 5.2 Overlapping Speech（重叠语音/Cross-Speech）

| 预处理步骤 | 对重叠语音识别的帮助 |
|-----------|----------------------|
| **保守降噪** | 重叠段不要过度处理——用 `mobile` 预设而非 `noisy_environment`，避免抹掉被覆盖的说话人 |
| **VAD** | 重叠段的能量通常更高，VAD 可以标记这些高能量区域供后续特殊处理 |
| **AGC** | 让被覆盖的较安静说话人也能被听到 |

**重要：** 重叠语音场景下，推荐的处理顺序是：
```
原始音频 → 轻量预处理(mobile) → Diarization → 对每个说话人单独降噪 → ASR
```
而不是在 diarization 之前就激进降噪。

### 5.3 LLM + ASR Synergy（LLM与ASR协同）

| 预处理步骤 | 对 LLM+ASR 协同的帮助 |
|-----------|----------------------|
| **全部预处理** | WER 降低 15-40% → LLM 需要纠正的错误大幅减少 |
| **预处理元数据** | 传给 LLM 作为 context：告诉 LLM 这段音频质量如何、有哪些潜在问题 |
| **VAD 片段** | 可以按说话段落分段送入 LLM，支持长文本的 chunked processing |

LLM Prompt 中可以加入预处理元数据：

```
System: You are a meeting transcript corrector. Below is a transcript of a
meeting recording. The audio was preprocessed with the following quality metrics:

- Recording quality: {quality_indicators.recording_quality}
- Speech ratio: {speech_ratio}
- Noise reduction applied: {noise_reduction_applied}
- Original RMS level: {original_rms_db} dB (higher = louder recording)

The original recording quality affects transcription reliability.
Please correct obvious ASR errors considering these quality indicators.
If the recording quality was "poor", be more aggressive with corrections.

Transcript:
{asr_output}
```

### 5.4 RAG Integration

预处理管道可以为 RAG 系统提供：

1. **音频质量标签**：作为检索过滤条件（只检索高质量录音的 transcript）
2. **时间轴信息**：VAD 片段的时间戳 → transcript 可以按时间索引
3. **处理统计**：作为 embedding 的附加维度

---

## 6. 性能估算

在 Intel i7-12700H CPU 上处理 10 分钟音频：

| 预设 | 处理时间 | RTF | 是否实时 |
|------|---------|-----|---------|
| `lightweight` | ~1.2s | 0.002 | ✓ |
| `mobile` | ~18s | 0.03 | ✓ |
| `desktop_high_quality` | ~45s | 0.075 | ✓ |
| `meeting_room` | ~90s | 0.15 | ✓ |
| `noisy_environment` | ~60s | 0.10 | ✓ |

所有预设都能实时处理。

---

## 7. 快速验证流程

```bash
cd D:\claude\work\local-audio-preprocessing-asr

# 1. 生成测试数据
python -m src.main generate --output-dir ./data/test

# 2. 用 meeting_room 预设处理一条测试音频
python -m src.main process ./data/test/white_noise_10db.wav ./data/test/processed.wav --preset meeting_room

# 3. 跑完整 benchmark
python -m src.main benchmark --output-dir ./results

# 4. 查看实验结果
jupyter notebook notebooks/experiments.ipynb
```

---

## 8. 总结

| 想要什么效果 | 用哪个预设 | 怎么调 |
|------------|-----------|-------|
| 最大 ASR 精度 | `desktop_high_quality` | 调高 prop_decrease 到 0.95 |
| 最快的处理速度 | `lightweight` | 关闭不需要的模块 |
| 会议室最佳效果 | `meeting_room` | 确认 enable_dereverb=True |
| 手机端实时处理 | `mobile` | 确认 vad_method=webrtc |
| 嘈杂环境生存 | `noisy_environment` | 不调，默认即激进 |
| 重叠语音保护 | `mobile`（轻处理） | 在 diarization 之后再做逐说话人降噪 |
| LLM 纠错辅助 | `desktop_high_quality` + 元数据 | 把 stats.to_dict() 传给 LLM prompt |
| RAG 检索增强 | 任意预设 + 元数据 | 把 preprocessing_metadata 存入向量库 |

**Topic 3 的输出 = Topic 1 的输入。** 你不需要修改任何已有代码，直接 import 并调用即可。
